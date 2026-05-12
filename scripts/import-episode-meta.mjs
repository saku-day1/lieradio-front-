/**
 * Excel（リエラジ.xlsx）から episodeMeta.json を生成する。
 *
 * 使い方:
 *   node scripts/import-episode-meta.mjs [path/to/リエラジ.xlsx]
 *
 * 既定パス: data/manual/リエラジ.xlsx（リポジトリに置いた場合）
 * 環境変数: LIERADIO_EXCEL で上書き可
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "episodeMeta.json");

const DEFAULT_XLSX = path.join(ROOT, "data", "manual", "リエラジ.xlsx");

/**
 * @param {string} text
 * @returns {{ type: string, searchable: boolean, visibleInList: boolean, priority: number } | null}
 */
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

/**
 * @param {string} name
 * @param {string} type
 * @param {boolean} searchable
 * @param {boolean} visibleInList
 * @param {number} priority
 */
function tagObj(name, type, searchable, visibleInList, priority) {
  return {
    name: String(name).trim(),
    type,
    searchable: !!searchable,
    visibleInList: !!visibleInList,
    priority: Number.isFinite(priority) ? priority : 0
  };
}

/** @returns {unknown[][]} */
function readSheetRows(xlsxPath) {
  const buf = fs.readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.includes("Sheet1") ? "Sheet1" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
}

function parseBroadcastNumber(cell) {
  const s = String(cell ?? "").trim();
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

function main() {
  const argPath = process.argv[2];
  const envPath = process.env.LIERADIO_EXCEL || "";
  const xlsxPath = path.resolve(argPath || envPath || DEFAULT_XLSX);

  if (!fs.existsSync(xlsxPath)) {
    console.error("Excel が見つかりません:", xlsxPath);
    console.error(
      "次のいずれかで指定してください:\n" +
        "  引数: node scripts/import-episode-meta.mjs <path>\n" +
        "  環境変数 LIERADIO_EXCEL\n" +
        "  または data/manual/リエラジ.xlsx を作成"
    );
    process.exit(1);
  }

  const rows = readSheetRows(xlsxPath);
  /** @type {object[]} */
  const out = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;

    const num = parseBroadcastNumber(row[0]);
    if (!Number.isFinite(num) || num < 1) continue;

    /** @type {ReturnType<typeof tagObj>[]} */
    const tags = [];

    const corners = [row[1], row[2]]
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
    corners.forEach((name) => {
      tags.push(tagObj(name, "corner", true, true, 100));
    });

    const lunch = String(row[3] ?? "").trim();
    if (lunch) {
      tags.push(tagObj(lunch, "lunchSong", true, true, 95));
    }

    for (const idx of [4, 5, 6]) {
      const raw = String(row[idx] ?? "").trim();
      if (!raw) continue;
      const cls = classifyRemark(raw);
      if (!cls) continue;
      tags.push(tagObj(raw, cls.type, cls.searchable, cls.visibleInList, cls.priority));
    }

    for (const idx of [7, 8]) {
      const raw = String(row[idx] ?? "").trim();
      if (!raw) continue;
      tags.push(tagObj(raw, "liveImpression", true, false, 30));
    }

    const eventText = String(row[9] ?? "").trim();
    if (eventText) {
      tags.push(tagObj(eventText, "eventImpression", true, false, 28));
    }

    const animeText = String(row[10] ?? "").trim();
    if (animeText) {
      tags.push(tagObj(animeText, "animeImpression", true, false, 28));
    }

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

    out.push({
      broadcastNumber: num,
      excelRow: ri + 1,
      corners,
      lunchTimeRequestSong: lunch || "",
      tags,
      primaryTagsForList,
      flags,
      exportedAt: new Date().toISOString()
    });
  }

  out.sort((a, b) => a.broadcastNumber - b.broadcastNumber);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote", OUT, "records:", out.length, "from", xlsxPath);
}

main();
