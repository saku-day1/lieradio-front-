/**
 * episodeMeta.json に videoId を一括付与する一回限りのブートストラップスクリプト。
 *
 * 使い方:
 *   node scripts/backfill-video-ids.mjs
 *
 * 動作:
 *   - data/episodes.json の youtubeUrl から videoId を抽出
 *   - episodeMeta の各エントリに対し:
 *       broadcastNumber がある → episodes の broadcastNumber で完全一致 → videoId を付与
 *       titleKeyword がある    → episodes のタイトル部分一致          → videoId を付与
 *   - 既に videoId が設定済みのエントリはスキップ（上書きしない）
 *   - 結合できなかったエントリは警告を出力して videoId なしのまま保持
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const EPISODES_PATH = path.join(ROOT, "data", "episodes.json");
const META_PATH = path.join(ROOT, "data", "episodeMeta.json");

function extractVideoId(url) {
  if (typeof url !== "string") return "";
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

function main() {
  const episodes = JSON.parse(fs.readFileSync(EPISODES_PATH, "utf8"));
  const metaRecords = JSON.parse(fs.readFileSync(META_PATH, "utf8"));

  // broadcastNumber → videoId マップを構築
  const byBroadcastNumber = new Map();
  for (const ep of episodes) {
    const n = ep.broadcastNumber;
    if (typeof n === "number" && Number.isFinite(n)) {
      const vid = extractVideoId(ep.youtubeUrl);
      if (vid) byBroadcastNumber.set(n, vid);
    }
  }

  let matched = 0;
  let skipped = 0;
  let unmatched = 0;

  const updated = metaRecords.map((record) => {
    // 既に videoId が設定済みならスキップ
    if (typeof record.videoId === "string" && record.videoId.trim()) {
      skipped++;
      return record;
    }

    // broadcastNumber で完全一致
    const n = record.broadcastNumber;
    if (typeof n === "number" && Number.isFinite(n)) {
      const vid = byBroadcastNumber.get(n);
      if (vid) {
        matched++;
        return { videoId: vid, ...record };
      }
      console.warn(`[WARN] broadcastNumber=${n} に対応する videoId が見つかりません`);
      unmatched++;
      return record;
    }

    // titleKeyword でタイトル部分一致（公開録音など broadcastNumber なし回）
    const kw = record.titleKeyword;
    if (typeof kw === "string" && kw.trim()) {
      const ep = episodes.find(
        (e) => typeof e.title === "string" && e.title.includes(kw.trim())
      );
      if (ep) {
        const vid = extractVideoId(ep.youtubeUrl);
        if (vid) {
          matched++;
          return { videoId: vid, ...record };
        }
      }
      console.warn(`[WARN] titleKeyword="${kw}" に対応する videoId が見つかりません`);
      unmatched++;
      return record;
    }

    console.warn("[WARN] broadcastNumber も titleKeyword もないエントリ:", JSON.stringify(record).slice(0, 80));
    unmatched++;
    return record;
  });

  fs.writeFileSync(META_PATH, JSON.stringify(updated, null, 2), "utf8");
  console.log(`完了: 付与=${matched}, スキップ(既存)=${skipped}, 未解決=${unmatched}`);
  if (unmatched > 0) {
    console.log("※ 未解決エントリは videoId なしのまま保持されています。手動で確認してください。");
  }
}

main();
