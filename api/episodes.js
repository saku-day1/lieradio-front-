/**
 * Vercel Serverless Function
 * YouTube APIキーをサーバー側だけで利用し、フロントへ露出させない。
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";
const CACHE_TTL_MS = Number(process.env.EPISODES_CACHE_TTL_MS || 10 * 60 * 1000);
const STALE_TTL_MS = Number(process.env.EPISODES_STALE_TTL_MS || 6 * 60 * 60 * 1000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.EPISODES_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.EPISODES_RATE_LIMIT_MAX_REQUESTS || 30);
const YOUTUBE_FETCH_TIMEOUT_MS = Number(process.env.YOUTUBE_FETCH_TIMEOUT_MS || 12000);
const YOUTUBE_FETCH_RETRIES = Number(process.env.YOUTUBE_FETCH_RETRIES || 2);

let episodesCache = {
  data: null,
  fetchedAt: 0
};
const ipRateState = new Map();

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
  setResponseHeaders(response);

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  const clientIp = getClientIp(request);
  if (isRateLimited(clientIp)) {
    return response.status(429).json({ error: "Too Many Requests" });
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const playlistId = process.env.YOUTUBE_PLAYLIST_ID;

    if (!apiKey || !playlistId) {
      return response.status(500).json({
        error: "Missing YOUTUBE_API_KEY or YOUTUBE_PLAYLIST_ID"
      });
    }

    const cacheAge = Date.now() - episodesCache.fetchedAt;
    if (episodesCache.data && cacheAge < CACHE_TTL_MS) {
      return response.status(200).json(episodesCache.data);
    }

    const items = await fetchAllPlaylistItems(apiKey, playlistId);
    const episodes = items.map((item, index) => toEpisode(item, index + 1));
    const normalized = normalizeEpisodes(episodes);

    episodesCache = {
      data: normalized,
      fetchedAt: Date.now()
    };

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
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket?.remoteAddress || "unknown";
}

function isRateLimited(clientIp) {
  const now = Date.now();
  const state = ipRateState.get(clientIp);
  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateState.set(clientIp, { windowStart: now, count: 1 });
    return false;
  }

  state.count += 1;
  ipRateState.set(clientIp, state);
  return state.count > RATE_LIMIT_MAX_REQUESTS;
}

function setResponseHeaders(response) {
  response.setHeader("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=3600");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
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
  const castMembers = uniqueNames([...mainCast, ...guests]);

  return {
    episodeNumber,
    broadcastNumber: extractBroadcastNumber(title),
    title,
    mainCast,
    guests,
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

  // "坂倉 花（鬼塚冬毬役）" -> "坂倉 花"
  const nameOnly = withoutPrefix.split("（")[0].trim();

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
