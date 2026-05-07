/**
 * Vercel Serverless Function
 * YouTube APIキーをサーバー側だけで利用し、フロントへ露出させない。
 */
import { Redis } from "@upstash/redis";
import { collectAbsentCastNames } from "./absence-names.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";
const CACHE_TTL_MS = Number(process.env.EPISODES_CACHE_TTL_MS || 10 * 60 * 1000);
const STALE_TTL_MS = Number(process.env.EPISODES_STALE_TTL_MS || 6 * 60 * 60 * 1000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.EPISODES_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.EPISODES_RATE_LIMIT_MAX_REQUESTS || 30);
const RATE_LIMIT_MAX_STATE_SIZE = Number(process.env.EPISODES_RATE_LIMIT_MAX_STATE_SIZE || 5000);
const YOUTUBE_FETCH_TIMEOUT_MS = Number(process.env.YOUTUBE_FETCH_TIMEOUT_MS || 12000);
const YOUTUBE_FETCH_RETRIES = Number(process.env.YOUTUBE_FETCH_RETRIES || 2);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const PERSIST_CACHE_KEY = process.env.EPISODES_CACHE_KEY || "episodes_cache_v1";
const PERSIST_CACHE_TTL_SEC = Number(process.env.EPISODES_PERSIST_CACHE_TTL_SEC || 7 * 24 * 60 * 60);

let episodesCache = {
  data: null,
  fetchedAt: 0
};
const ipRateState = new Map();
let redisClient = null;

// ユーザー指定: 抽出対象はこの名前だけ
const ALLOWED_CAST_MEMBERS = [
  "伊達さゆり",
  "坂倉花",
  "岬なこ",
  "青山なぎさ",
  "Liyuu",
  "ペイトン尚未",
  "結那",
  "結木ゆな",
  "薮島朱音",
  "鈴原希実",
  "大熊和奏",
  "絵森彩",
  "吉武千颯",
  "相良茉優",
  "田中ちえ美"
];

// 表記ゆれを正規化する辞書
const NAME_ALIASES = {
  "伊達 さゆり": "伊達さゆり",
  "岬 なこ": "岬なこ",
  "絵森 彩": "絵森彩",
  "大熊 和奏": "大熊和奏",
  "坂倉 花": "坂倉花",
  "籔島 朱音": "薮島朱音",
  "籔島朱音": "薮島朱音",
  "鈴原希美": "鈴原希実",
  "吉武 千颯": "吉武千颯",
  "結木 ゆな": "結木ゆな",
  "相良 茉優": "相良茉優",
  "田中 ちえ美": "田中ちえ美"
};

export default async function handler(request, response) {
  const requestedRefresh = isRefreshRequest(request);
  const forceRefresh = requestedRefresh && isAuthorizedCron(request);
  const skipOriginCheck = forceRefresh;

  if (!skipOriginCheck && !isAllowedOrigin(request)) {
    return response.status(403).json({ error: "Forbidden" });
  }

  setResponseHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(204).end();
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  if (requestedRefresh && !forceRefresh) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  if (!forceRefresh) {
    const clientIp = getClientIp(request);
    const rateState = checkRateLimit(clientIp);
    if (rateState.limited) {
      response.setHeader("Retry-After", String(rateState.retryAfterSeconds));
      return response.status(429).json({ error: "Too Many Requests" });
    }
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const playlistId = process.env.YOUTUBE_PLAYLIST_ID;

    if (!isValidYouTubeApiKey(apiKey) || !isValidPlaylistId(playlistId)) {
      console.error("Invalid or missing required environment variables.");
      return response.status(500).json({ error: "Server is not configured correctly." });
    }

    const persistentCache = await readPersistentCache();
    hydrateInMemoryCache(persistentCache);

    const cacheAge = Date.now() - episodesCache.fetchedAt;
    if (!forceRefresh && episodesCache.data && cacheAge < CACHE_TTL_MS) {
      return response.status(200).json(episodesCache.data);
    }

    const items = await fetchAllPlaylistItems(apiKey, playlistId);
    const episodes = items.map((item, index) => toEpisode(item, index + 1));
    const normalized = normalizeEpisodes(episodes);

    const nextCache = {
      data: normalized,
      fetchedAt: Date.now()
    };
    episodesCache = nextCache;
    await writePersistentCache(nextCache);

    return response.status(200).json(normalized);
  } catch (error) {
    console.error(error);
    const staleAge = Date.now() - episodesCache.fetchedAt;
    if (episodesCache.data && staleAge < STALE_TTL_MS) {
      response.setHeader("Warning", "110 - Response is stale");
      return response.status(200).json(episodesCache.data);
    }
    return response.status(500).json({ error: "Failed to load playlist data." });
  }
}

function isForceRefresh(request) {
  return getQueryParam(request, "refresh") === "1";
}

function isRefreshRequest(request) {
  if (isForceRefresh(request)) {
    return true;
  }

  const pathname = getRequestPathname(request);
  return pathname === "/api/episodes/refresh";
}

function isAuthorizedCron(request) {
  if (!CRON_SECRET) {
    return false;
  }

  const authHeader = request.headers.authorization;
  const cronHeader = request.headers["x-cron-secret"];
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  return cronHeader === CRON_SECRET || bearerToken === CRON_SECRET;
}

function hydrateInMemoryCache(persistentCache) {
  if (!persistentCache?.data || !persistentCache?.fetchedAt) {
    return;
  }

  if (episodesCache.fetchedAt >= persistentCache.fetchedAt) {
    return;
  }

  episodesCache = persistentCache;
}

async function readPersistentCache() {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get(PERSIST_CACHE_KEY);
    if (!value || typeof value !== "object") {
      return null;
    }

    if (!Array.isArray(value.data) || typeof value.fetchedAt !== "number") {
      return null;
    }

    return value;
  } catch (error) {
    console.error("Failed to read persistent cache.", error);
    return null;
  }
}

async function writePersistentCache(cacheValue) {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(PERSIST_CACHE_KEY, cacheValue, { ex: PERSIST_CACHE_TTL_SEC });
  } catch (error) {
    console.error("Failed to write persistent cache.", error);
  }
}

function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

async function fetchAllPlaylistItems(apiKey, playlistId) {
  const allItems = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId,
      key: apiKey
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url = `${YOUTUBE_API_BASE}?${params.toString()}`;
    const result = await fetchWithRetry(url, YOUTUBE_FETCH_RETRIES);
    if (!result.ok) {
      throw new Error(`YouTube API failed: ${result.status}`);
    }

    const data = await result.json();
    allItems.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return allItems;
}

function normalizeEpisodes(episodes) {
  // 公開日の古い順で回番号を振り直す（第1回が一番古い想定）
  return episodes
    .filter((episode) => {
      if (shouldExcludeFromAggregation(episode.title)) {
        return false;
      }
      if (episode.castMembers.length === 0) {
        return false;
      }
      if (isPublicRecordingTitle(episode.title)) {
        return true;
      }
      return episode.broadcastNumber !== null;
    })
    .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
    .map((episode, index) => ({
      ...episode,
      episodeNumber: index + 1
    }));
}

async function fetchWithRetry(url, retries) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), YOUTUBE_FETCH_TIMEOUT_MS);
    try {
      const result = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (result.ok || result.status < 500 || attempt === retries) {
        return result;
      }
      lastError = new Error(`YouTube API temporary failure: ${result.status}`);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt === retries) {
        throw error;
      }
    }
  }

  throw lastError || new Error("YouTube API request failed");
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return sanitizeIp(forwardedFor.split(",")[0].trim());
  }

  return sanitizeIp(request.socket?.remoteAddress || "unknown");
}

function checkRateLimit(clientIp) {
  cleanupRateLimitMap();

  const now = Date.now();
  const state = ipRateState.get(clientIp);
  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateState.set(clientIp, { windowStart: now, count: 1, updatedAt: now });
    return { limited: false, retryAfterSeconds: 0 };
  }

  state.count += 1;
  state.updatedAt = now;
  ipRateState.set(clientIp, state);
  if (state.count > RATE_LIMIT_MAX_REQUESTS) {
    const elapsedMs = now - state.windowStart;
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsedMs) / 1000));
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function cleanupRateLimitMap() {
  if (ipRateState.size < RATE_LIMIT_MAX_STATE_SIZE) {
    return;
  }

  const expireBefore = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, state] of ipRateState.entries()) {
    if (state.updatedAt < expireBefore) {
      ipRateState.delete(ip);
    }
  }

  if (ipRateState.size < RATE_LIMIT_MAX_STATE_SIZE) {
    return;
  }

  // メモリ逼迫を防ぐため、古い順に間引く
  const entries = [...ipRateState.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const removeCount = Math.ceil(entries.length * 0.25);
  for (let i = 0; i < removeCount; i += 1) {
    ipRateState.delete(entries[i][0]);
  }
}

function setResponseHeaders(request, response) {
  setCorsHeaders(request, response);
  response.setHeader("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=3600");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
}

function setCorsHeaders(request, response) {
  const origin = getRequestOrigin(request);
  if (!origin) {
    return;
  }

  if (!ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function isAllowedOrigin(request) {
  const origin = getRequestOrigin(request);
  if (!origin) {
    return true;
  }

  if (!ALLOWED_ORIGIN) {
    return true;
  }

  return origin === ALLOWED_ORIGIN;
}

function getRequestOrigin(request) {
  const origin = request.headers.origin;
  return typeof origin === "string" ? origin : "";
}

function getQueryParam(request, key) {
  const fromQueryObject = request.query?.[key];
  if (typeof fromQueryObject === "string") {
    return fromQueryObject;
  }
  if (Array.isArray(fromQueryObject) && typeof fromQueryObject[0] === "string") {
    return fromQueryObject[0];
  }

  const requestUrl = typeof request.url === "string" ? request.url : "";
  const candidateUrls = [
    requestUrl,
    request.headers["x-original-url"],
    request.headers["x-rewrite-url"],
    request.headers["x-forwarded-uri"],
    request.headers["x-invoke-path"],
    request.headers["x-matched-path"]
  ];

  for (const candidate of candidateUrls) {
    if (typeof candidate !== "string" || !candidate) {
      continue;
    }
    try {
      const parsed = new URL(candidate, "http://localhost");
      const value = parsed.searchParams.get(key);
      if (value) {
        return value;
      }
    } catch (error) {
      // no-op
    }
  }

  return "";
}

function getRequestPathname(request) {
  const candidates = [
    request.url,
    request.headers["x-original-url"],
    request.headers["x-rewrite-url"],
    request.headers["x-forwarded-uri"],
    request.headers["x-invoke-path"],
    request.headers["x-matched-path"]
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) {
      continue;
    }

    try {
      const parsed = new URL(candidate, "http://localhost");
      if (parsed.pathname) {
        return parsed.pathname;
      }
    } catch (error) {
      // no-op
    }
  }

  return "";
}

function sanitizeIp(rawIp) {
  return String(rawIp).replace(/[^\da-fA-F:.,]/g, "").slice(0, 64) || "unknown";
}

function isValidYouTubeApiKey(value) {
  return typeof value === "string" && /^AIza[\w-]{20,}$/.test(value);
}

function isValidPlaylistId(value) {
  return typeof value === "string" && /^[\w-]{10,64}$/.test(value);
}

function toEpisode(item, episodeNumber) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const title = snippet.title || "タイトル未設定";
  const description = snippet.description || "";
  const videoId = (snippet.resourceId && snippet.resourceId.videoId) || "";
  const rawPublishedAt = contentDetails.videoPublishedAt || snippet.publishedAt || "";
  const publishedAt = toJstDate(rawPublishedAt);
  const { mainCast, guests } = extractCastFromDescription(description, title);
  const absent = collectAbsentCastNames(description, ALLOWED_CAST_MEMBERS);
  const mainCastFiltered = mainCast.filter((name) => !absent.has(name));
  const guestsFiltered = guests.filter((name) => !absent.has(name));
  const castMembers = uniqueNames([...mainCastFiltered, ...guestsFiltered]);

  return {
    episodeNumber,
    broadcastNumber: extractBroadcastNumber(title),
    title,
    mainCast: mainCastFiltered,
    guests: guestsFiltered,
    castMembers,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt
  };
}

function toJstDate(isoDateString) {
  if (!isoDateString) {
    return "";
  }

  const date = new Date(isoDateString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function extractBroadcastNumber(title) {
  const matchByHash = title.match(/#\s*(\d+)/i);
  if (matchByHash) {
    return Number(matchByHash[1]);
  }

  const matchByJapanese = title.match(/第\s*(\d+)\s*回/);
  if (matchByJapanese) {
    return Number(matchByJapanese[1]);
  }

  return null;
}

function extractCastFromDescription(description, title = "") {
  const lines = description.split("\n");
  const mainCast = [];
  const guests = [];
  let section = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    // 見出し検出（表記ゆれをできるだけ吸収）
    const isGuestSection = /ゲスト\s*出演/.test(line) || /ゲスト/.test(line) || /^Guest[:：]/i.test(line);
    if (isGuestSection) {
      section = "guest";
      continue;
    }

    const isMainSection =
      /メイン\s*MC/i.test(line) ||
      /メイン\s*(パーソナリティ|キャスト)/i.test(line) ||
      /^パーソナリティ/.test(line) ||
      /^MC[:：]/i.test(line) ||
      /^【\s*出演\s*】$/.test(line) ||
      /^出演[:：]?$/.test(line);
    if (isMainSection) {
      section = "main";
      continue;
    }

    // 別セクションに入ったら出演者抽出モードを終了
    if (/^【.+】/.test(line) && !/出演/.test(line)) {
      section = "";
      continue;
    }

    if (!section) {
      continue;
    }

    const names = splitAndCleanNames(line);
    if (names.length === 0) {
      continue;
    }

    if (section === "main") {
      mainCast.push(...names);
    } else if (section === "guest") {
      guests.push(...names);
    }
  }

  // セクションから拾えない古い回向けに、既知メンバー全文探索も併用
  const normalizedText = normalizeForSearch(description);
  if (mainCast.length === 0 && guests.length === 0) {
    // 公開録音回は全文探索を避け、説明文の出演欄のみを信頼する
    if (isPublicRecordingTitle(title)) {
      return applySpecialRules(description, { mainCast: [], guests: [] });
    }

    const detected = ALLOWED_CAST_MEMBERS.filter((name) =>
      normalizedText.includes(normalizeForSearch(name))
    );
    return applySpecialRules(description, { mainCast: [], guests: detected });
  }

  return applySpecialRules(description, {
    mainCast: uniqueNames(mainCast),
    guests: uniqueNames(guests)
  });
}

function splitAndCleanNames(line) {
  const chunks = line
    .split(/[、\/]/)
    .map((part) => cleanName(part))
    .filter(Boolean);

  return chunks;
}

function cleanName(rawLine) {
  // 先頭の記号・絵文字・全角空白を除去
  const withoutPrefix = rawLine
    .replace(/^[・\-ー◆🎤🌟🌈\s　]+/, "")
    .replace(/^※\s*/, "");

  // "坂倉 花（鬼塚冬毬役）" / "伊達さゆり(澁谷かのん役)" -> 役名の手前まで
  const nameOnly = withoutPrefix.split(/[（(]/)[0].trim();

  if (!nameOnly) {
    return "";
  }

  // 説明文ノイズ行は除外
  const noisePattern =
    /(出演見合わせ|詳細|ご確認|配信日程|お便り|関連サイト|公式|毎週|過去回|https?:\/\/|#lovelive|プロジェクト)/;
  if (noisePattern.test(nameOnly)) {
    return "";
  }

  const normalized = normalizeDisplayName(nameOnly);
  return normalized;
}

function uniqueNames(names) {
  return [...new Set(names)].filter((name) => ALLOWED_CAST_MEMBERS.includes(name));
}

function normalizeDisplayName(name) {
  const compact = name.replace(/\s+/g, "");
  return NAME_ALIASES[name] || NAME_ALIASES[compact] || compact;
}

function normalizeForSearch(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function shouldExcludeFromAggregation(title) {
  return /耐久|総集編/.test(title);
}

function isPublicRecordingTitle(title) {
  return /公開録音|公録/.test(title);
}

function applySpecialRules(description, cast) {
  const shouldExcludeSakakura = description.includes("リエラジ！への出演を見合わせることとなりました");

  if (!shouldExcludeSakakura) {
    return {
      mainCast: uniqueNames(cast.mainCast),
      guests: uniqueNames(cast.guests)
    };
  }

  return {
    mainCast: uniqueNames(cast.mainCast).filter((name) => name !== "坂倉花"),
    guests: uniqueNames(cast.guests).filter((name) => name !== "坂倉花")
  };
}
