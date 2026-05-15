/**
 * Vercel Serverless Function
 * Google Sheets からエピソードメタ情報を取得し、Redis にキャッシュして返す。
 * シートを更新後に ?refresh=1 または Authorization: Bearer <CRON_SECRET> でキャッシュを破棄できる。
 */
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

const FALLBACK_META_PATH = path.join(process.cwd(), "data", "episodeMeta.json");

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const CACHE_KEY = process.env.EPISODE_META_CACHE_KEY || "episode_meta_cache_v1";
const CACHE_TTL_SEC = Number(process.env.EPISODE_META_CACHE_TTL_SEC || 3600);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

let redisClient = null;

export default async function handler(request, response) {
  const forceRefresh = isAuthorizedRefresh(request);

  if (!isAllowedOrigin(request) && !forceRefresh) {
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

  // Redis キャッシュを確認
  if (!forceRefresh) {
    const cached = await readRedisCache();
    if (cached) {
      setDebugHeaders(response, cached, "redis");
      return response.status(200).json(cached);
    }
  }

  // Google Sheets から取得・処理
  try {
    const data = await fetchAndProcess();
    await writeRedisCache(data);
    setDebugHeaders(response, data, "sheets");
    return response.status(200).json(data);
  } catch (error) {
    console.error("[episode-meta] fetch error:", error);

    // force refresh 時は失敗を返す（GitHub Actions が検知できるように）
    if (forceRefresh) {
      const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      return response.status(500).json({
        error: String(error.message),
        env: {
          hasApiKey: Boolean(apiKey),
          hasSpreadsheetId: Boolean(spreadsheetId),
        },
      });
    }

    // 通常アクセス時: Redis にフォールバック
    const redisStale = await readRedisCache();
    if (redisStale) {
      response.setHeader("Warning", "110 - Response is stale");
      setDebugHeaders(response, redisStale, "redis-stale");
      return response.status(200).json(redisStale);
    }

    return response.status(500).json({ error: "Failed to load episode meta." });
  }
}

// ---------------------------------------------------------------------------
// Google Sheets 取得・処理
// ---------------------------------------------------------------------------

async function fetchAndProcess() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const gid = process.env.GOOGLE_SHEETS_SHEET_GID || "";

  if (!apiKey || !spreadsheetId) {
    console.error(
      `[episode-meta] 環境変数未設定: GOOGLE_SHEETS_API_KEY=${apiKey ? "set" : "MISSING"}, GOOGLE_SHEETS_SPREADSHEET_ID=${spreadsheetId ? "set" : "MISSING"}`
    );
    throw new Error("GOOGLE_SHEETS_API_KEY / GOOGLE_SHEETS_SPREADSHEET_ID が未設定です。");
  }
  console.log(`[episode-meta] Sheets fetch start: spreadsheetId=${spreadsheetId}, gid=${gid || "(none)"}`);

  const rows = await fetchSheetRows(apiKey, spreadsheetId, gid);
  if (!rows || rows.length === 0) {
    throw new Error("シートにデータがありません。");
  }

  return processRows(rows);
}

async function fetchSheetRows(apiKey, spreadsheetId, gid) {
  const metaUrl = `${SHEETS_API_BASE}/${spreadsheetId}?key=${encodeURIComponent(apiKey)}`;
  const metaRes = await fetch(metaUrl, { cache: "no-store" });
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => "(body read failed)");
    throw new Error(`スプレッドシート情報取得失敗: ${metaRes.status} - ${body}`);
  }
  const meta = await metaRes.json();

  let sheetName = meta.sheets?.[0]?.properties?.title ?? "Sheet1";
  if (gid) {
    const matched = meta.sheets?.find((s) => String(s.properties.sheetId) === String(gid));
    if (matched) sheetName = matched.properties.title;
  }

  const range = encodeURIComponent(sheetName);
  const dataUrl = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}?key=${encodeURIComponent(apiKey)}`;
  const dataRes = await fetch(dataUrl, { cache: "no-store" });
  if (!dataRes.ok) {
    const body = await dataRes.text().catch(() => "(body read failed)");
    throw new Error(`シートデータ取得失敗: ${dataRes.status} - ${body}`);
  }
  const data = await dataRes.json();
  return data.values ?? [];
}

/**
 * episodeMeta.json から broadcastNumber → videoId のマップを返す。
 * Sheets の videoId 列が空の行の補完にのみ使用する。
 */
function readFallbackData() {
  const candidates = [
    FALLBACK_META_PATH,
    "/var/task/data/episodeMeta.json",
    path.resolve("data", "episodeMeta.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const records = JSON.parse(raw);
      const numericMap = new Map();
      for (const r of records) {
        if (Number.isFinite(r.broadcastNumber) && r.broadcastNumber >= 1 && typeof r.videoId === "string" && r.videoId) {
          numericMap.set(r.broadcastNumber, r.videoId);
        }
      }
      console.log(`[episode-meta] episodeMeta.json を読み込みました: ${filePath} (${numericMap.size} 件)`);
      return numericMap;
    } catch (_) {
      // 次の候補へ
    }
  }

  console.warn("[episode-meta] episodeMeta.json が見つかりませんでした。videoId 補完をスキップします。");
  return new Map();
}

function processRows(rows) {
  const header = rows[0];
  const colVideoId = header.indexOf("videoId");
  const colNum = header.findIndex((h) => /^回$/.test(String(h).trim()));

  if (colNum === -1) {
    throw new Error(`「回」列が見つかりません。ヘッダー: ${header.join(", ")}`);
  }

  const numericMap = readFallbackData();
  const out = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;

    const get = (i) => String(row[i] ?? "").trim();

    const num = parseBroadcastNumber(get(colNum));
    const hasValidNum = Number.isFinite(num) && num >= 1;

    // Sheets の videoId 列を主キーとして使う。
    // 空の場合のみ episodeMeta.json の numericMap で補完する。
    let videoId = "";
    if (colVideoId !== -1) {
      const raw = extractVideoId(get(colVideoId)) || get(colVideoId);
      if (/^[A-Za-z0-9_-]{11}$/.test(raw)) videoId = raw;
    }
    if (!videoId && hasValidNum) {
      videoId = numericMap.get(num) ?? "";
    }

    // videoId も broadcastNumber もない行はスキップ
    if (!videoId && !hasValidNum) continue;

    const o = colNum - 1;

    const corners = [get(o + 2), get(o + 3)].filter(Boolean);
    const lunch = get(o + 4);

    const tags = [];
    corners.forEach((name) => tags.push(tagObj(name, "corner", true, true, 100)));
    if (lunch) tags.push(tagObj(lunch, "lunchSong", true, true, 95));

    for (const idx of [o + 5, o + 6, o + 7]) {
      const raw = get(idx);
      if (!raw) continue;
      const cls = classifyRemark(raw);
      if (!cls) continue;
      const name = cls.type === "birthday" ? extractBirthdayName(raw) : raw;
      tags.push(tagObj(name, cls.type, cls.searchable, cls.visibleInList, cls.priority));
    }

    const incidentText = get(o + 8);
    if (incidentText) tags.push(tagObj(incidentText, "incident", true, false, 8));

    const publicRecText = get(o + 9);
    if (publicRecText) tags.push(tagObj(publicRecText, "publicRecordingNote", true, false, 22));

    for (const idx of [o + 10, o + 11]) {
      const raw = get(idx);
      if (raw) tags.push(tagObj(raw, "liveImpression", true, false, 30));
    }

    const eventText = get(o + 12);
    if (eventText) tags.push(tagObj(eventText, "eventImpression", true, false, 28));

    const animeText = get(o + 13);
    if (animeText) tags.push(tagObj(animeText, "animeImpression", true, false, 28));

    const primaryCandidates = [...tags]
      .filter((t) => t.visibleInList && t.type !== "corner" && t.type !== "lunchSong")
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, "ja"));

    const primaryTagsForList = primaryCandidates.slice(0, 2).map((t) => ({
      name: t.name,
      type: t.type,
      searchable: t.searchable,
      visibleInList: t.visibleInList,
      priority: t.priority
    }));

    const allTagText = tags.map((t) => t.name).join("\n");

    const flags = {
      hasCorner: corners.length > 0,
      hasLunchSong: Boolean(lunch),
      hasBirthdayTag: tags.some((t) => t.type === "birthday"),
      hasLiveImpression: tags.some((t) => t.type === "liveImpression"),
      hasEventImpression: tags.some((t) => t.type === "eventImpression"),
      hasAnimeImpression: tags.some((t) => t.type === "animeImpression"),
      hasNetaTag: tags.some((t) => ["netaTag", "animeSeasonTag", "eventName"].includes(t.type)),
      mentionsPublicRecordingInRemark: tags.some((t) => {
        if (t.type === "publicRecordingNote") return true;
        return /公開録音|公録/.test(String(t.name || ""));
      }),
      mentionsIjigenFes: /異次元フェス|異次元|イジゲン/i.test(allTagText + eventText + animeText + lunch),
      mentionsGen3Join: /3期|加入|新メンバー|11人|11名|三期|第3期/i.test(allTagText)
    };

    const entry = {
      ...(hasValidNum ? { broadcastNumber: num } : {}),
      corners,
      lunchTimeRequestSong: lunch || "",
      tags,
      primaryTagsForList,
      flags
    };
    if (videoId) entry.videoId = videoId;

    out.push(entry);
  }

  out.sort((a, b) => a.broadcastNumber - b.broadcastNumber);
  return out;
}

// ---------------------------------------------------------------------------
// タグ処理ユーティリティ（import-episode-meta.mjs と同一ロジック）
// ---------------------------------------------------------------------------

function tagObj(name, type, searchable, visibleInList, priority) {
  return {
    name: String(name).trim(),
    type,
    searchable: !!searchable,
    visibleInList: !!visibleInList,
    priority: Number.isFinite(priority) ? priority : 0
  };
}

function classifyRemark(text) {
  const t = String(text).trim();
  if (!t) return null;

  if (/公開録音|公録/.test(t)) {
    return { type: "publicRecordingNote", searchable: true, visibleInList: false, priority: 22 };
  }
  if (/誕生日|バースデー|たんじょうび|おたんじょうび/i.test(t)) {
    return { type: "birthday", searchable: true, visibleInList: false, priority: 12 };
  }
  if (/事件|おそろっち|炎上|ハプニング|ミスリード/i.test(t)) {
    return { type: "incident", searchable: true, visibleInList: false, priority: 8 };
  }
  if (/異次元フェス|異次元|イジゲン/i.test(t)) {
    return { type: "eventName", searchable: true, visibleInList: false, priority: 70 };
  }
  if (
    /シブヤノオト|Anime\s*Japan|THE\s*FIRST\s*TAKE|オタクに恋は困る|ミュージックステーション|Mステ|めざましテレビ|テレビ朝日/i.test(t)
  ) {
    return { type: "externalShow", searchable: true, visibleInList: false, priority: 18 };
  }
  if (/期キ|^[123１２３]期|^アニメ\d+期|^\d+期\s*/.test(t) && t.length <= 14) {
    return { type: "animeSeasonTag", searchable: true, visibleInList: true, priority: 88 };
  }
  const shortish = t.length <= 12;
  return {
    type: "netaTag",
    searchable: true,
    visibleInList: shortish && !/^https?:\/\//i.test(t),
    priority: shortish ? 45 : 25
  };
}

function extractBirthdayName(text) {
  const m = String(text).trim().match(/^(.+?)(?:誕生日|バースデー|たんじょうび|おたんじょうび)/i);
  return m ? m[1].trim() : text;
}

function extractVideoId(url) {
  if (typeof url !== "string") return "";
  const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return shortMatch ? shortMatch[1] : "";
}

function parseBroadcastNumber(cell) {
  const n = Number.parseInt(String(cell ?? "").trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Redis キャッシュ
// ---------------------------------------------------------------------------

function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  redisClient = new Redis({ url, token });
  return redisClient;
}

async function readRedisCache() {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const value = await redis.get(CACHE_KEY);
    return Array.isArray(value) ? value : null;
  } catch (error) {
    console.error("[episode-meta] Redis read error:", error);
    return null;
  }
}

async function writeRedisCache(data) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(CACHE_KEY, data, { ex: CACHE_TTL_SEC });
  } catch (error) {
    console.error("[episode-meta] Redis write error:", error);
  }
}

export async function invalidateCache() {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(CACHE_KEY);
  } catch (error) {
    console.error("[episode-meta] Redis invalidate error:", error);
  }
}

// ---------------------------------------------------------------------------
// 認証・CORS
// ---------------------------------------------------------------------------

function isAuthorizedRefresh(request) {
  const isRefresh = getQueryParam(request, "refresh") === "1";
  if (!isRefresh) return false;
  if (!CRON_SECRET) return false;

  const authHeader = request.headers.authorization;
  const cronHeader = request.headers["x-cron-secret"];
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

  return cronHeader === CRON_SECRET || bearerToken === CRON_SECRET;
}

function isAllowedOrigin(request) {
  const origin = getRequestOrigin(request);
  if (!origin) return true;
  if (!ALLOWED_ORIGIN) return true;
  return origin === ALLOWED_ORIGIN;
}

function getRequestOrigin(request) {
  const origin = request.headers.origin;
  return typeof origin === "string" ? origin : "";
}

function getQueryParam(request, key) {
  const fromQuery = request.query?.[key];
  if (typeof fromQuery === "string") return fromQuery;

  const requestUrl = typeof request.url === "string" ? request.url : "";
  try {
    const parsed = new URL(requestUrl, "http://localhost");
    return parsed.searchParams.get(key) ?? "";
  } catch (_) {
    return "";
  }
}

function setResponseHeaders(request, response) {
  const origin = getRequestOrigin(request);
  if (origin && (!ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
}

/**
 * デバッグ用レスポンスヘッダーを付与する。
 * DevTools の Network タブで確認できる。
 *   X-Meta-Source  : データの取得元（sheets / redis / memory / redis-stale / memory-stale）
 *   X-Meta-Count   : レコード件数
 *   X-Meta-Time    : ヘッダー付与時刻（ISO8601）
 */
function setDebugHeaders(response, data, source) {
  response.setHeader("X-Meta-Source", source);
  response.setHeader("X-Meta-Count", Array.isArray(data) ? String(data.length) : "0");
  response.setHeader("X-Meta-Time", new Date().toISOString());
}
