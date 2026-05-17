/**
 * Google Sheets データ取得・パースのユーティリティ。
 * api/episode-meta.js と scripts/import-episode-meta.mjs で共有する。
 */

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export function tagObj(name, type, searchable, visibleInList, priority) {
  return {
    name: String(name).trim(),
    type,
    searchable: !!searchable,
    visibleInList: !!visibleInList,
    priority: Number.isFinite(priority) ? priority : 0
  };
}

export function classifyRemark(text) {
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

export function extractBirthdayName(text) {
  const m = String(text).trim().match(/^(.+?)(?:誕生日|バースデー|たんじょうび|おたんじょうび)/i);
  return m ? m[1].trim() : text;
}

/**
 * YouTube URL から videoId（11文字）を抽出する。
 * watch?v= 形式と youtu.be/ 形式の両方に対応。
 */
export function extractVideoId(url) {
  if (typeof url !== "string") return "";
  const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return shortMatch ? shortMatch[1] : "";
}

export function parseBroadcastNumber(cell) {
  const n = Number.parseInt(String(cell ?? "").trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Google Sheets API から全行を取得して返す。
 * @param {string} apiKey
 * @param {string} spreadsheetId
 * @param {string} gid - シート GID（省略時は最初のシート）
 * @returns {Promise<string[][]>}
 */
export async function fetchSheetRows(apiKey, spreadsheetId, gid) {
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
