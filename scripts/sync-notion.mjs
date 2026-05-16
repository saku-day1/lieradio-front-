/**
 * Google Sheets のエピソードメタ情報を Notion Database に同期する。
 *
 * データソース（FROM_JSON で切り替え）:
 *   FROM_JSON=true  → data/episodes.json + data/episodeMeta.json を使用（API 不要）
 *   FROM_JSON=false → Google Sheets + YouTube API をリアルタイムで取得（デフォルト）
 *
 * 必須環境変数:
 *   NOTION_TOKEN, NOTION_DATABASE_ID
 *
 * FROM_JSON=false 時の追加必須変数:
 *   GOOGLE_SHEETS_API_KEY, GOOGLE_SHEETS_SPREADSHEET_ID
 *
 * 任意:
 *   GOOGLE_SHEETS_SHEET_GID, YOUTUBE_API_KEY, YOUTUBE_PLAYLIST_ID
 *   SYNC_LIMIT  (数値: 同期件数上限。省略=全件)
 *   DRY_RUN=true  (Notion への書き込みをスキップ)
 *
 * 実行: node scripts/sync-notion.mjs
 * npm:  npm run sync-notion
 */

import { Client } from "@notionhq/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const DATABASE_ID = process.env.NOTION_DATABASE_ID ?? "";
const DRY_RUN = process.env.DRY_RUN === "true";
const FROM_JSON = process.env.FROM_JSON === "true";
const LIMIT = process.env.SYNC_LIMIT ? Number(process.env.SYNC_LIMIT) : Infinity;

const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY ?? "";
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
const SHEET_GID = process.env.GOOGLE_SHEETS_SHEET_GID ?? "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID ?? "";

// Notion API は 3 req/sec が目安。1 upsert = query + update/create = 2 req
const NOTION_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// データ取得（モード切替）
// ---------------------------------------------------------------------------

async function loadEpisodes() {
  if (FROM_JSON) {
    console.log("[sync-notion] ソース: ローカル JSON ファイル (data/episodes.json + data/episodeMeta.json)");
    return loadFromJsonFiles();
  }
  console.log("[sync-notion] ソース: Google Sheets + YouTube API");
  return loadFromApis();
}

// ---------------------------------------------------------------------------
// モード A: ローカル JSON ファイルから読み込む
// ---------------------------------------------------------------------------

function loadFromJsonFiles() {
  const episodesPath = path.join(DATA_DIR, "episodes.json");
  const metaPath = path.join(DATA_DIR, "episodeMeta.json");

  if (!fs.existsSync(episodesPath)) throw new Error(`見つかりません: ${episodesPath}`);
  if (!fs.existsSync(metaPath)) throw new Error(`見つかりません: ${metaPath}`);

  const episodes = JSON.parse(fs.readFileSync(episodesPath, "utf8"));
  const metaList = JSON.parse(fs.readFileSync(metaPath, "utf8"));

  // episodeMeta を videoId でインデックス化
  const metaMap = new Map();
  for (const m of metaList) {
    if (m.videoId) metaMap.set(m.videoId, m);
  }

  const result = [];
  for (const ep of episodes) {
    // youtubeUrl から videoId を抽出
    const videoId = extractVideoId(ep.youtubeUrl ?? "") || ep.videoId;
    if (!videoId) continue;

    const meta = metaMap.get(videoId) ?? {};
    result.push(mergeEpisode(videoId, ep, meta));
  }

  // episodeMeta にあって episodes にない回（公開録音など）も追加
  for (const [videoId, meta] of metaMap) {
    if (!result.some((e) => e.videoId === videoId)) {
      result.push(mergeEpisode(videoId, {}, meta));
    }
  }

  return result;
}

function mergeEpisode(videoId, ep, meta) {
  const tags = meta.tags ?? [];
  const flags = meta.flags ?? {};

  return {
    videoId,
    broadcastNumber: ep.broadcastNumber ?? null,
    title: ep.title ?? "",
    castMembers: ep.castMembers ?? [],
    publishedAt: ep.publishedAt ?? "",
    corners: meta.corners ?? [],
    lunchSong: meta.lunchTimeRequestSong ?? "",
    liveImpressions: tags.filter((t) => t.type === "liveImpression").map((t) => t.name),
    eventImpression: tags.find((t) => t.type === "eventImpression")?.name ?? "",
    animeImpression: tags.find((t) => t.type === "animeImpression")?.name ?? "",
    birthdayTags: tags.filter((t) => t.type === "birthday").map((t) => t.name),
    incidentText: tags.find((t) => t.type === "incident")?.name ?? "",
    isPublicRecording:
      flags.mentionsPublicRecordingInRemark === true ||
      tags.some((t) => t.type === "publicRecordingNote"),
  };
}

// ---------------------------------------------------------------------------
// モード B: Google Sheets + YouTube API からリアルタイム取得
// ---------------------------------------------------------------------------

async function loadFromApis() {
  if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
    throw new Error("GOOGLE_SHEETS_API_KEY / GOOGLE_SHEETS_SPREADSHEET_ID が未設定です");
  }

  const [sheetsData, youtubeData] = await Promise.all([
    fetchSheetsData(),
    fetchYouTubeData(),
  ]);

  console.log(`[sync-notion] Sheets: ${sheetsData.size} 件, YouTube: ${youtubeData.size} 件`);

  const result = [];
  for (const [videoId, meta] of sheetsData) {
    const yt = youtubeData.get(videoId) ?? {};
    result.push({ ...meta, ...yt, videoId });
  }
  return result;
}

// Google Sheets 取得（episode-meta.js の fetchSheetRows + processRows を移植）
async function fetchSheetsData() {
  const base = "https://sheets.googleapis.com/v4/spreadsheets";

  const metaRes = await fetch(`${base}/${SPREADSHEET_ID}?key=${enc(SHEETS_API_KEY)}`);
  if (!metaRes.ok) throw new Error(`Sheets meta error: ${metaRes.status}`);
  const meta = await metaRes.json();

  let sheetName = meta.sheets?.[0]?.properties?.title ?? "Sheet1";
  if (SHEET_GID) {
    const matched = meta.sheets?.find(
      (s) => String(s.properties.sheetId) === String(SHEET_GID)
    );
    if (matched) sheetName = matched.properties.title;
  }

  const dataRes = await fetch(
    `${base}/${SPREADSHEET_ID}/values/${enc(sheetName)}?key=${enc(SHEETS_API_KEY)}`
  );
  if (!dataRes.ok) throw new Error(`Sheets data error: ${dataRes.status}`);
  const data = await dataRes.json();

  return processSheetRows(data.values ?? []);
}

function processSheetRows(rows) {
  if (rows.length < 2) return new Map();

  const header = rows[0];
  const colVideoId = header.indexOf("videoId");
  const colNum = header.findIndex((h) => /^回$/.test(String(h).trim()));

  if (colNum === -1) throw new Error(`「回」列が見つかりません。ヘッダー: ${header.join(", ")}`);

  const result = new Map();

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;

    const get = (i) => String(row[i] ?? "").trim();
    const numRaw = Number.parseInt(get(colNum), 10);
    const broadcastNumber = Number.isFinite(numRaw) && numRaw >= 1 ? numRaw : null;

    let videoId = "";
    if (colVideoId !== -1) {
      const raw = extractVideoId(get(colVideoId)) || get(colVideoId);
      if (/^[A-Za-z0-9_-]{11}$/.test(raw)) videoId = raw;
    }

    if (!videoId && !broadcastNumber) continue;
    if (!videoId) continue;

    const o = colNum - 1;
    const corners = [get(o + 2), get(o + 3)].filter(Boolean);
    const lunchSong = get(o + 4);
    const remarks = [get(o + 5), get(o + 6), get(o + 7)].filter(Boolean);
    const incidentText = get(o + 8);
    const publicRecText = get(o + 9);
    const liveImpressions = [get(o + 10), get(o + 11)].filter(Boolean);
    const eventImpression = get(o + 12);
    const animeImpression = get(o + 13);
    const isPublicRecording = Boolean(
      publicRecText || /公開録音|公録/.test(corners.join("") + remarks.join(""))
    );
    const birthdayTags = remarks
      .filter((r) => /誕生日|バースデー/i.test(r))
      .map((r) => {
        const m = r.match(/^(.+?)(?:誕生日|バースデー)/i);
        return m ? m[1].trim() : r;
      });

    result.set(videoId, {
      videoId, broadcastNumber, corners, lunchSong,
      liveImpressions, eventImpression, animeImpression,
      isPublicRecording, birthdayTags, incidentText,
    });
  }

  return result;
}

// YouTube プレイリスト取得（episodes.js の fetchAllPlaylistItems を移植）
async function fetchYouTubeData() {
  if (!YOUTUBE_API_KEY || !PLAYLIST_ID) {
    console.warn("[sync-notion] YouTube 環境変数が未設定: タイトル・出演者・公開日は空になります");
    return new Map();
  }

  const base = "https://www.googleapis.com/youtube/v3/playlistItems";
  const allItems = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId: PLAYLIST_ID,
      key: YOUTUBE_API_KEY,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${base}?${params.toString()}`);
    if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
    const data = await res.json();
    allItems.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  const result = new Map();
  for (const item of allItems) {
    const snippet = item.snippet ?? {};
    const contentDetails = item.contentDetails ?? {};
    const videoId = snippet.resourceId?.videoId ?? "";
    if (!videoId) continue;
    result.set(videoId, {
      videoId,
      title: snippet.title ?? "",
      castMembers: extractCastFromDescription(snippet.description ?? "", snippet.title ?? ""),
      publishedAt: toJstDate(contentDetails.videoPublishedAt || snippet.publishedAt || ""),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// キャスト抽出（episodes.js のロジックを移植）
// ---------------------------------------------------------------------------

const ALLOWED_CAST_MEMBERS = [
  "伊達さゆり", "坂倉花", "岬なこ", "青山なぎさ", "Liyuu",
  "ペイトン尚未", "結那", "結木ゆな", "薮島朱音", "鈴原希実",
  "大熊和奏", "絵森彩", "吉武千颯", "相良茉優", "田中ちえ美",
];

const NAME_ALIASES = {
  "伊達 さゆり": "伊達さゆり", "岬 なこ": "岬なこ",
  "絵森 彩": "絵森彩", "大熊 和奏": "大熊和奏",
  "坂倉 花": "坂倉花", "籔島 朱音": "薮島朱音",
  "籔島朱音": "薮島朱音", "鈴原希美": "鈴原希実",
  "吉武 千颯": "吉武千颯", "結木 ゆな": "結木ゆな",
  "相良 茉優": "相良茉優", "田中 ちえ美": "田中ちえ美",
};

function extractCastFromDescription(description, title) {
  const lines = description.split("\n");
  const mainCast = [], guests = [];
  let section = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/ゲスト\s*出演|ゲスト|^Guest[:：]/i.test(line)) { section = "guest"; continue; }
    if (/メイン\s*MC|メイン\s*(パーソナリティ|キャスト)|^パーソナリティ|^MC[:：]|^【\s*出演\s*】$|^出演[:：]?$/i.test(line)) {
      section = "main"; continue;
    }
    if (/^【.+】/.test(line) && !/出演/.test(line)) { section = ""; continue; }
    if (!section) continue;
    if (/お休み|欠席|体調不良|出演を見合わせ|出演見合わせ/.test(line)) continue;
    line.split(/[、\/]/).map(cleanName).filter(Boolean).forEach((n) => {
      section === "main" ? mainCast.push(n) : guests.push(n);
    });
  }

  if (mainCast.length === 0 && guests.length === 0) {
    if (/公開録音|公録/.test(title)) return [];
    const norm = description.replace(/\s+/g, "").toLowerCase();
    return ALLOWED_CAST_MEMBERS.filter((n) => norm.includes(n.replace(/\s+/g, "").toLowerCase()));
  }
  return uniqueCast([...mainCast, ...guests]);
}

function cleanName(raw) {
  const s = raw.replace(/^[・\-ー◆🎤🌟🌈\s　]+/, "").replace(/^※\s*/, "").split(/[（(]/)[0].trim();
  if (!s) return "";
  if (/(出演見合わせ|詳細|ご確認|配信日程|お便り|関連サイト|公式|毎週|過去回|https?:\/\/|#lovelive)/.test(s)) return "";
  const compact = s.replace(/\s+/g, "");
  return NAME_ALIASES[s] || NAME_ALIASES[compact] || compact;
}

function uniqueCast(names) {
  return [...new Set(names)].filter((n) => ALLOWED_CAST_MEMBERS.includes(n));
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function extractVideoId(url) {
  if (typeof url !== "string") return "";
  const w = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (w) return w[1];
  const s = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return s ? s[1] : "";
}

function toJstDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function enc(s) { return encodeURIComponent(s); }

// ---------------------------------------------------------------------------
// Notion upsert
// ---------------------------------------------------------------------------

// ntn- 形式の新トークンは fetch を直接使って送信する
const USE_FETCH_FALLBACK = NOTION_TOKEN.startsWith("ntn");

const notion = USE_FETCH_FALLBACK ? null : new Client({ auth: NOTION_TOKEN });

async function notionRequest(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Notion API error: ${res.status}`);
  }
  return res.json();
}

async function findPageByVideoId(videoId) {
  const body = {
    filter: { property: "videoId", rich_text: { equals: videoId } },
    page_size: 1,
  };
  const res = USE_FETCH_FALLBACK
    ? await notionRequest("POST", `/databases/${DATABASE_ID}/query`, body)
    : await notion.databases.query({ database_id: DATABASE_ID, ...body });
  return res.results[0] ?? null;
}

function richText(str) {
  return [{ text: { content: String(str).slice(0, 2000) } }];
}

function multiSelect(arr) {
  return arr.map((name) => ({ name: String(name).slice(0, 100) }));
}

function buildProperties(episode) {
  const props = {
    タイトル: { title: richText(episode.title || `第${episode.broadcastNumber ?? "?"}回`) },
    videoId: { rich_text: richText(episode.videoId) },
    "YouTube URL": { url: `https://youtu.be/${episode.videoId}` },
    公開録音: { checkbox: Boolean(episode.isPublicRecording) },
  };

  if (episode.broadcastNumber != null) props.回 = { number: episode.broadcastNumber };
  if (episode.publishedAt)            props.公開日 = { date: { start: episode.publishedAt } };
  if (episode.castMembers?.length)    props.出演者 = { multi_select: multiSelect(episode.castMembers) };
  if (episode.corners?.length)        props.コーナー = { multi_select: multiSelect(episode.corners) };
  if (episode.lunchSong)              props.リクエスト曲 = { rich_text: richText(episode.lunchSong) };
  if (episode.liveImpressions?.length) props.ライブ感想 = { multi_select: multiSelect(episode.liveImpressions) };
  if (episode.eventImpression)        props.イベント感想 = { rich_text: richText(episode.eventImpression) };
  if (episode.animeImpression)        props.アニメ感想 = { rich_text: richText(episode.animeImpression) };
  if (episode.birthdayTags?.length)   props.誕生日 = { multi_select: multiSelect(episode.birthdayTags) };
  if (episode.incidentText)           props.出来事 = { rich_text: richText(episode.incidentText) };

  return props;
}

function buildPageBody(episode) {
  const line = (emoji, label, value) =>
    value ? `${emoji} ${label}: ${value}` : null;

  const lines = [
    line("🎙", "出演者", episode.castMembers?.join(" / ")),
    line("📅", "公開日", episode.publishedAt),
    line("🎪", "コーナー", episode.corners?.join(" / ")),
    line("🎵", "リクエスト曲", episode.lunchSong),
    line("🎤", "ライブ感想", episode.liveImpressions?.join(" / ")),
    line("📝", "イベント感想", episode.eventImpression),
    line("📺", "アニメ感想", episode.animeImpression),
    line("🎂", "誕生日", episode.birthdayTags?.join(" / ")),
    line("⚡", "出来事", episode.incidentText),
    episode.isPublicRecording ? "🎤 公開録音回" : null,
  ].filter(Boolean);

  const paragraphs = lines.map((text) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  }));

  // YouTube URL はブックマークブロックで埋め込む
  const bookmark = {
    object: "block",
    type: "bookmark",
    bookmark: { url: `https://youtu.be/${episode.videoId}` },
  };

  return [...paragraphs, bookmark];
}

async function appendPageBody(pageId, episode) {
  const children = buildPageBody(episode);
  if (USE_FETCH_FALLBACK) {
    await notionRequest("PATCH", `/blocks/${pageId}/children`, { children });
  } else {
    await notion.blocks.children.append({ block_id: pageId, children });
  }
}

function thumbnailCover(videoId) {
  return {
    type: "external",
    external: { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
  };
}

async function upsertEpisode(episode) {
  const props = buildProperties(episode);
  const cover = thumbnailCover(episode.videoId);
  const existing = await findPageByVideoId(episode.videoId);
  if (existing) {
    if (!DRY_RUN) {
      if (USE_FETCH_FALLBACK) {
        await notionRequest("PATCH", `/pages/${existing.id}`, { properties: props, cover });
      } else {
        await notion.pages.update({ page_id: existing.id, properties: props, cover });
      }
    }
    return "updated";
  } else {
    if (!DRY_RUN) {
      const body = { parent: { database_id: DATABASE_ID }, properties: props, cover };
      let newPage;
      if (USE_FETCH_FALLBACK) {
        newPage = await notionRequest("POST", "/pages", body);
      } else {
        newPage = await notion.pages.create(body);
      }
      await appendPageBody(newPage.id, episode);
    }
    return "created";
  }
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  if (!NOTION_TOKEN || !DATABASE_ID) {
    console.error("[sync-notion] NOTION_TOKEN / NOTION_DATABASE_ID が未設定です");
    process.exit(1);
  }

  console.log(`[sync-notion] 開始: FROM_JSON=${FROM_JSON}, DRY_RUN=${DRY_RUN}, LIMIT=${isFinite(LIMIT) ? LIMIT : "全件"}`);

  const episodes = await loadEpisodes();
  episodes.sort((a, b) => (a.broadcastNumber ?? Infinity) - (b.broadcastNumber ?? Infinity));

  const targets = isFinite(LIMIT) ? episodes.slice(0, LIMIT) : episodes;
  console.log(`[sync-notion] 同期対象: ${targets.length} 件 / 全 ${episodes.length} 件`);

  let created = 0, updated = 0, errors = 0;

  for (const ep of targets) {
    try {
      const result = await upsertEpisode(ep);
      result === "created" ? created++ : updated++;
      const label = ep.broadcastNumber ? `第${ep.broadcastNumber}回` : ep.videoId;
      console.log(`[${result}] ${label} ${ep.title || ""}`);
      await new Promise((r) => setTimeout(r, NOTION_DELAY_MS));
    } catch (e) {
      errors++;
      console.error(`[error] ${ep.videoId}:`, e.message);
    }
  }

  console.log(`\n[sync-notion] 完了: created=${created} updated=${updated} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[sync-notion] 致命的エラー:", e);
  process.exit(1);
});
