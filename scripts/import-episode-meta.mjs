/**
 * Google スプレッドシートから episodeMeta.json を生成する。
 *
 * 使い方:
 *   node scripts/import-episode-meta.mjs
 *
 * 必要な環境変数（.env.local に記載）:
 *   GOOGLE_SHEETS_API_KEY        - Google Sheets API キー
 *   GOOGLE_SHEETS_SPREADSHEET_ID - スプレッドシートID
 *   GOOGLE_SHEETS_SHEET_GID      - シートID（gid=XXXX の値）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  tagObj,
  classifyRemark,
  extractBirthdayName,
  extractVideoId,
  parseBroadcastNumber,
  fetchSheetRows,
} from "../lib/sheetParser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "episodeMeta.json");

// .env.local を読み込む
function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

async function main() {
  loadEnv();

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const gid = process.env.GOOGLE_SHEETS_SHEET_GID || "";

  if (!apiKey || !spreadsheetId) {
    console.error("環境変数が不足しています。.env.local に GOOGLE_SHEETS_API_KEY と GOOGLE_SHEETS_SPREADSHEET_ID を設定してください。");
    process.exit(1);
  }

  console.log("Google スプレッドシートからデータを取得中...");
  const rows = await fetchSheetRows(apiKey, spreadsheetId, gid);

  if (rows.length === 0) {
    console.error("シートにデータがありません。");
    process.exit(1);
  }

  // 1行目はヘッダー（videoId, 回, コーナー, ...）
  const header = rows[0];
  const colVideoId = header.indexOf("videoId");
  const colNum = header.findIndex((h) => /^回$/.test(String(h).trim()));

  if (colNum === -1) {
    console.error("「回」列が見つかりません。ヘッダー:", header);
    process.exit(1);
  }

  console.log(`列構成: videoId=${colVideoId}, 回=${colNum}`);

  // 既存ファイルから titleKeyword エントリと videoId マップを引き継ぐ
  const preserved = [];
  const existingVideoIdMap = new Map();
  try {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    for (const e of existing) {
      if (!Number.isFinite(e.broadcastNumber) && typeof e.titleKeyword === "string") {
        preserved.push(e);
      } else if (Number.isFinite(e.broadcastNumber) && typeof e.videoId === "string" && e.videoId.trim()) {
        existingVideoIdMap.set(e.broadcastNumber, e.videoId);
      }
    }
  } catch (_) {}

  const out = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;

    const get = (i) => String(row[i] ?? "").trim();

    // videoId を先に取り出す（公開録音回など回番号が非整数の行もスキップしないため）
    let videoId = "";
    if (colVideoId !== -1) {
      videoId = extractVideoId(get(colVideoId)) || get(colVideoId);
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = "";
    }

    const num = parseBroadcastNumber(get(colNum));
    const hasValidNum = Number.isFinite(num) && num >= 1;

    if (!videoId && hasValidNum) videoId = existingVideoIdMap.get(num) ?? "";

    // videoId も broadcastNumber もない行はスキップ
    if (!videoId && !hasValidNum) continue;

    // 列オフセット（videoId列が先頭に追加された分をずらす）
    const o = colNum - 1; // 「回」の手前までの列数（videoId列分）

    const corners = [get(o + 2), get(o + 3)]
      .filter(Boolean);

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
      videoId: videoId || undefined,
      ...(hasValidNum ? { broadcastNumber: num } : {}),
      excelRow: ri + 1,
      corners,
      lunchTimeRequestSong: lunch || "",
      tags,
      primaryTagsForList,
      flags,
      exportedAt: new Date().toISOString()
    };
    if (!entry.videoId) delete entry.videoId;

    out.push(entry);
  }

  out.sort((a, b) => a.broadcastNumber - b.broadcastNumber);

  const finalOut = [...preserved, ...out];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(finalOut, null, 2), "utf8");
  console.log(`書き出し完了: ${OUT} (${finalOut.length} 件 / titleKeyword引き継ぎ: ${preserved.length} 件)`);

  const noVid = finalOut.filter((e) => !e.videoId);
  if (noVid.length > 0) {
    console.warn(`[WARN] videoId 未設定: ${noVid.length} 件`);
    noVid.forEach((e) => console.warn(`  第${e.broadcastNumber}回`));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
