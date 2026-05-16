/**
 * Google Sheets のエピソードメタ情報を Notion Database に同期する。
 *
 * 環境変数:
 *   必須: NOTION_TOKEN, NOTION_DATABASE_ID
 *   必須: GOOGLE_SHEETS_API_KEY, GOOGLE_SHEETS_SPREADSHEET_ID
 *   任意: GOOGLE_SHEETS_SHEET_GID  (省略時は先頭シート)
 *   任意: YOUTUBE_API_KEY, YOUTUBE_PLAYLIST_ID  (未設定でもタイトル・出演者なしで動く)
 *   任意: SYNC_LIMIT  (数値: 同期件数上限。省略=全件)
 *   任意: DRY_RUN=true  (Notion への書き込みをスキップ)
 *
 * 実行: node scripts/sync-notion.mjs
 * npm:  npm run sync-notion
 */

import { Client } from "@notionhq/client";

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const DATABASE_ID = process.env.NOTION_DATABASE_ID ?? "";
const DRY_RUN = process.env.DRY_RUN === "true";
const LIMIT = process.env.SYNC_LIMIT ? Number(process.env.SYNC_LIMIT) : Infinity;

const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY ?? "";
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";
const SHEET_GID = process.env.GOOGLE_SHEETS_SHEET_GID ?? "";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID ?? "";

// Notion API は 3 req/sec が目安。1 upsert = query + update/create = 2 req。
const NOTION_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// キャスト定数（episodes.js と同一）
// ---------------------------------------------------------------------------

const ALLOWED_CAST_MEMBERS = [
  "伊達さゆり", "坂倉花", "岬なこ", "青山なぎさ", "Liyuu",
  "ペイトン尚未", "結那", "結木ゆな", "薮島朱音", "鈴原希実",
  "大熊和奏", "絵森彩", "吉武千颯", "相良茉優", "田中ちえ美",
];

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
  "田中 ちえ美": "田中ちえ美",
};

// ---------------------------------------------------------------------------
// Google Sheets 取得（episode-meta.js の fetchSheetRows + processRows を移植）
// ---------------------------------------------------------------------------

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

    // videoId も回番号もない行はスキップ
    if (!videoId && !broadcastNumber) continue;
    // Notion の主キーになる videoId がない行はスキップ
    if (!videoId) continue;

    const o = colNum - 1;
    const corners = [get(o + 2), get(o + 3)].filter(Boolean);
    const lunchSong = get(o + 4);

    // 備考列（F〜H）から誕生日・公開録音・事件を拾う
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
      videoId,
      broadcastNumber,
      corners,
      lunchSong,
      liveImpressions,
      eventImpression,
      animeImpression,
      isPublicRecording,
      birthdayTags,
      incidentText,
    });
  }

  return result;
}

function extractVideoId(url) {
  if (typeof url !== "string") return "";
  const w = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (w) return w[1];
  const s = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return s ? s[1] : "";
}

function enc(s) {
  return encodeURIComponent(s);
}

// ---------------------------------------------------------------------------
// YouTube プレイリスト取得（episodes.js の fetchAllPlaylistItems を移植）
// ---------------------------------------------------------------------------

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

    const rawPublishedAt = contentDetails.videoPublishedAt || snippet.publishedAt || "";
    result.set(videoId, {
      videoId,
      title: snippet.title ?? "",
      castMembers: extractCastFromDescription(snippet.description ?? "", snippet.title ?? ""),
      publishedAt: toJstDate(rawPublishedAt),
    });
  }
  return result;
}

// episodes.js の extractCastFromDescription を移植（セクション解析 + 全文探索フォールバック）
function extractCastFromDescription(description, title) {
  const lines = description.split("\n");
  const mainCast = [];
  const guests = [];
  let section = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/ゲスト\s*出演|ゲスト|^Guest[:：]/i.test(line)) { section = "guest"; continue; }
    if (
      /メイン\s*MC|メイン\s*(パーソナリティ|キャスト)|^パーソナリティ|^MC[:：]|^【\s*出演\s*】$|^出演[:：]?$/i.test(line)
    ) { section = "main"; continue; }
    if (/^【.+】/.test(line) && !/出演/.test(line)) { section = ""; continue; }
    if (!section) continue;
    if (isAbsenceLine(line)) continue;

    const names = line.split(/[、\/]/).map(cleanName).filter(Boolean);
    if (section === "main") mainCast.push(...names);
    else if (section === "guest") guests.push(...names);
  }

  if (mainCast.length === 0 && guests.length === 0) {
    // 公開録音は全文探索しない
    if (/公開録音|公録/.test(title)) return [];
    const norm = description.replace(/\s+/g, "").toLowerCase();
    return ALLOWED_CAST_MEMBERS.filter((n) => norm.includes(n.replace(/\s+/g, "").toLowerCase()));
  }

  return uniqueCast([...mainCast, ...guests]);
}

function cleanName(rawLine) {
  const withoutPrefix = rawLine
    .replace(/^[・\-ー◆🎤🌟🌈\s　]+/, "")
    .replace(/^※\s*/, "");
  const nameOnly = withoutPrefix.split(/[（(]/)[0].trim();
  if (!nameOnly) return "";
  if (/(出演見合わせ|詳細|ご確認|配信日程|お便り|関連サイト|公式|毎週|過去回|https?:\/\/|#lovelive|プロジェクト)/.test(nameOnly)) return "";
  const compact = nameOnly.replace(/\s+/g, "");
  return NAME_ALIASES[nameOnly] || NAME_ALIASES[compact] || compact;
}

function uniqueCast(names) {
  return [...new Set(names)].filter((n) => ALLOWED_CAST_MEMBERS.includes(n));
}

function isAbsenceLine(line) {
  return /お休み|休みとな|欠席|体調不良|体調の都合|都合により|ためお休み|によりお休み|出演を見合わせ|見合わせることとなりました|出演見合わせ/.test(line);
}

function toJstDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Notion upsert
// ---------------------------------------------------------------------------

const notion = new Client({ auth: NOTION_TOKEN });

async function findPageByVideoId(videoId) {
  const res = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: { property: "videoId", rich_text: { equals: videoId } },
    page_size: 1,
  });
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

  if (episode.broadcastNumber != null) {
    props.回 = { number: episode.broadcastNumber };
  }
  if (episode.publishedAt) {
    props.公開日 = { date: { start: episode.publishedAt } };
  }
  if (episode.castMembers?.length) {
    props.出演者 = { multi_select: multiSelect(episode.castMembers) };
  }
  if (episode.corners?.length) {
    props.コーナー = { multi_select: multiSelect(episode.corners) };
  }
  if (episode.lunchSong) {
    props.リクエスト曲 = { rich_text: richText(episode.lunchSong) };
  }
  if (episode.liveImpressions?.length) {
    props.ライブ感想 = { multi_select: multiSelect(episode.liveImpressions) };
  }
  if (episode.eventImpression) {
    props.イベント感想 = { rich_text: richText(episode.eventImpression) };
  }
  if (episode.animeImpression) {
    props.アニメ感想 = { rich_text: richText(episode.animeImpression) };
  }
  if (episode.birthdayTags?.length) {
    props.誕生日 = { multi_select: multiSelect(episode.birthdayTags) };
  }
  if (episode.incidentText) {
    props.出来事 = { rich_text: richText(episode.incidentText) };
  }

  return props;
}

async function upsertEpisode(episode) {
  const props = buildProperties(episode);
  const existing = await findPageByVideoId(episode.videoId);

  if (existing) {
    if (!DRY_RUN) {
      await notion.pages.update({ page_id: existing.id, properties: props });
    }
    return "updated";
  } else {
    if (!DRY_RUN) {
      await notion.pages.create({ parent: { database_id: DATABASE_ID }, properties: props });
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
  if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
    console.error("[sync-notion] GOOGLE_SHEETS_API_KEY / GOOGLE_SHEETS_SPREADSHEET_ID が未設定です");
    process.exit(1);
  }

  console.log(`[sync-notion] 開始: DRY_RUN=${DRY_RUN}, LIMIT=${isFinite(LIMIT) ? LIMIT : "全件"}`);

  const [sheetsData, youtubeData] = await Promise.all([
    fetchSheetsData(),
    fetchYouTubeData(),
  ]);

  console.log(`[sync-notion] Sheets: ${sheetsData.size} 件, YouTube: ${youtubeData.size} 件`);

  // videoId をキーに Sheets（主）+ YouTube（補完）でマージ
  const episodes = [];
  for (const [videoId, meta] of sheetsData) {
    const yt = youtubeData.get(videoId) ?? {};
    episodes.push({ ...meta, ...yt, videoId });
  }

  // broadcastNumber 昇順でソート（番号なし回は末尾）
  episodes.sort((a, b) => {
    const an = a.broadcastNumber ?? Infinity;
    const bn = b.broadcastNumber ?? Infinity;
    return an - bn;
  });

  const targets = isFinite(LIMIT) ? episodes.slice(0, LIMIT) : episodes;
  console.log(`[sync-notion] 同期対象: ${targets.length} 件`);

  let created = 0, updated = 0, errors = 0;

  for (const ep of targets) {
    try {
      const result = await upsertEpisode(ep);
      result === "created" ? created++ : updated++;
      const label = ep.broadcastNumber ? `第${ep.broadcastNumber}回` : ep.videoId;
      console.log(`[${result}] ${label} ${ep.title || ""}`);
      await sleep(NOTION_DELAY_MS);
    } catch (e) {
      errors++;
      console.error(`[error] ${ep.videoId}:`, e.message);
    }
  }

  console.log(`\n[sync-notion] 完了: created=${created} updated=${updated} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("[sync-notion] 致命的エラー:", e);
  process.exit(1);
});
