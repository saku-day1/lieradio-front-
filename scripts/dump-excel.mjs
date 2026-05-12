/**
 * Excel の中身を JSON にダンプして確認用に出力する。
 *
 * 使い方:
 *   node scripts/dump-excel.mjs [path/to/リエラジ.xlsx] [sheetName]
 *
 * 既定パス: data/manual/リエラジ.xlsx
 * 環境変数: LIERADIO_EXCEL で上書き可
 * 出力: data/excel-dump.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_XLSX = path.join(ROOT, "data", "manual", "リエラジ.xlsx");
const OUT = path.join(ROOT, "data", "excel-dump.json");

const argPath = process.argv[2];
const targetSheet = process.argv[3] ?? null;
const envPath = process.env.LIERADIO_EXCEL || "";
const xlsxPath = path.resolve(argPath || envPath || DEFAULT_XLSX);

if (!fs.existsSync(xlsxPath)) {
  console.error("Excel が見つかりません:", xlsxPath);
  process.exit(1);
}

console.log(`読み込み: ${xlsxPath}`);
const workbook = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
console.log(`シート一覧: ${workbook.SheetNames.join(", ")}`);

const result = {};
const sheets = targetSheet ? [targetSheet] : workbook.SheetNames;

for (const name of sheets) {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    console.warn(`シート "${name}" が見つかりません`);
    continue;
  }
  result[name] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2), "utf-8");
const total = Object.values(result).reduce((s, r) => s + r.length, 0);
console.log(`出力: ${OUT}  (${total} 行)`);
