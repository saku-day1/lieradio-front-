/**
 * OGP画像生成スクリプト
 * 使い方: npm run generate-ogp
 * 出力: public/ogp.png (1200x630)
 */
import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "ogp.png");

const W = 1200;
const H = 630;

// Liella! メンバーカラー
const MEMBER_COLORS = [
  "#FF6B9D", // 伊達さゆり（ピンク）
  "#FF9500", // 平安名すみれ（オレンジ）
  "#FFD700", // 唐 可可（イエロー）
  "#7DC3E8", // 嵐 千砂都（スカイブルー）
  "#9B59B6", // 澁谷 かのん（パープル）
  "#2ECC71", // ウィーン・マルガレーテ（グリーン）
  "#E74C3C", // 葉月 恋（レッド）
  "#1ABC9C", // 米女 メイ（ティール）
  "#F39C12", // 桜小路 きな子（アンバー）
  "#3498DB", // 鬼塚 夏美（ブルー）
  "#E91E63", // 桂城 フィーナ（ホットピンク）
];

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// 背景グラデーション
const bg = ctx.createLinearGradient(0, 0, W, H);
bg.addColorStop(0, "#0f0c29");
bg.addColorStop(0.5, "#302b63");
bg.addColorStop(1, "#24243e");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, W, H);

// 上部レインボーバー
const barH = 8;
const barGrad = ctx.createLinearGradient(0, 0, W, 0);
MEMBER_COLORS.forEach((c, i) => barGrad.addColorStop(i / (MEMBER_COLORS.length - 1), c));
ctx.fillStyle = barGrad;
ctx.fillRect(0, 0, W, barH);

// 下部レインボーバー
ctx.fillStyle = barGrad;
ctx.fillRect(0, H - barH, W, barH);

// 装飾サークル（背景）
const circleData = [
  { x: 60, y: 120, r: 80, color: "#FF6B9D" },
  { x: W - 80, y: 200, r: 100, color: "#7DC3E8" },
  { x: 150, y: H - 100, r: 60, color: "#FFD700" },
  { x: W - 120, y: H - 140, r: 90, color: "#9B59B6" },
  { x: W / 2 + 300, y: 80, r: 50, color: "#2ECC71" },
];
for (const { x, y, r, color } of circleData) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// メインコンテンツ領域（中央寄せ）
const padX = 80;
const contentY = 120;

// ロゴ風バッジ「リエラジ」
ctx.save();
const badgeGrad = ctx.createLinearGradient(padX, contentY, padX + 180, contentY + 56);
badgeGrad.addColorStop(0, "#FF6B9D");
badgeGrad.addColorStop(1, "#9B59B6");
drawRoundedRect(ctx, padX, contentY, 190, 56, 14);
ctx.fillStyle = badgeGrad;
ctx.fill();
ctx.font = "bold 30px 'sans-serif'";
ctx.fillStyle = "#ffffff";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText("リエラジ", padX + 95, contentY + 28);
ctx.restore();

// メインタイトル
ctx.save();
ctx.font = "bold 72px 'sans-serif'";
ctx.fillStyle = "#ffffff";
ctx.textAlign = "left";
ctx.textBaseline = "top";
ctx.shadowColor = "rgba(0,0,0,0.5)";
ctx.shadowBlur = 16;
ctx.fillText("出演者検索", padX, contentY + 76);
ctx.restore();

// サブタイトル
ctx.save();
ctx.font = "32px 'sans-serif'";
ctx.fillStyle = "rgba(255,255,255,0.85)";
ctx.textAlign = "left";
ctx.textBaseline = "top";
ctx.fillText("Liella! の放送回をまとめて検索・閲覧", padX, contentY + 168);
ctx.restore();

// 機能バッジ一覧
const features = ["メンバー絞り込み", "ユニット検索", "AND検索", "お気に入り", "詳細検索"];
let bx = padX;
const by = contentY + 230;
ctx.font = "22px 'sans-serif'";
for (const feat of features) {
  const tw = ctx.measureText(feat).width;
  const bw = tw + 28;
  drawRoundedRect(ctx, bx, by, bw, 42, 21);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(feat, bx + bw / 2, by + 21);
  bx += bw + 14;
}

// メンバーカラードット（下部）
const dotY = H - 60;
const dotR = 10;
const totalDotsW = MEMBER_COLORS.length * (dotR * 2 + 10) - 10;
let dx = (W - totalDotsW) / 2;
for (const color of MEMBER_COLORS) {
  ctx.beginPath();
  ctx.arc(dx + dotR, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  dx += dotR * 2 + 10;
}

// 出力
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, canvas.toBuffer("image/png"));
console.log(`OGP画像を生成しました: ${OUT_FILE}`);
