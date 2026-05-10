/**
 * アプリ全体で使う定数を一元管理する。
 * キャスト・ユニット情報を変更する場合はここだけ編集すればよい。
 */

export const MAX_AND_CAST_SELECTION = 5;

export const PRIORITY_CAST_FILTERS = [
  { name: "伊達さゆり", color: "#f39c12" },
  { name: "Liyuu",     color: "#5bc0de" },
  { name: "岬なこ",   color: "#ff7eb6" },
  { name: "ペイトン尚未", color: "#4caf50" },
  { name: "青山なぎさ", color: "#3b82f6" },
  { name: "鈴原希実", color: "#facc15" },
  { name: "薮島朱音", color: "#ef4444" },
  { name: "大熊和奏", color: "#f8fafc" },
  { name: "絵森彩",   color: "#ff9ed1" },
  { name: "結那",     color: "#a855f7" },
  { name: "坂倉花",   color: "#22c55e" }
];

export const UNIT_FILTERS = [
  {
    key: "kuuka",
    label: "クーカー",
    color: "linear-gradient(90deg, #5bc0de 0 48%, #f39c12 52% 100%)",
    members: ["伊達さゆり", "Liyuu"]
  },
  {
    key: "tomakanote",
    label: "トマカノーテ",
    color: "linear-gradient(90deg, #22c55e 0 31.333%, #f39c12 35.333% 64.666%, #a855f7 68.666% 100%)",
    members: ["伊達さゆり", "結那", "坂倉花"]
  },
  { key: "catchu",      label: "CatChu!",      color: "#ef4444", members: ["伊達さゆり", "ペイトン尚未", "薮島朱音"] },
  { key: "kaleidoscore",label: "KALEIDOSCORE", color: "#3b82f6", members: ["Liyuu", "青山なぎさ", "結那"] },
  { key: "syncri5e",    label: "5yncri5e!",    color: "#facc15", members: ["岬なこ", "鈴原希実", "大熊和奏", "絵森彩", "坂倉花"] },
  { key: "team-kodomo", label: "チームこども", color: "#ef4444", members: ["伊達さゆり", "Liyuu", "鈴原希実", "絵森彩"] },
  { key: "team-sports", label: "チームスポーツ", color: "#3b82f6", members: ["岬なこ", "ペイトン尚未", "薮島朱音", "結那"] },
  { key: "team-midori", label: "チームみどり", color: "#22c55e", members: ["青山なぎさ", "大熊和奏", "坂倉花"] },
  { key: "yuisaku",     label: "ゆいさく",     color: "#ff7eb6", members: ["結那", "坂倉花"] },
  { key: "sunnypassion",label: "Sunny Passion", color: "#f59e0b", members: ["吉武千颯", "結木ゆな"] },
  { key: "nijigasaki",  label: "虹ヶ咲",       color: "#fde047", members: ["相良茉優", "田中ちえ美"] }
];

/** フィルタボタンは持たないがバッジに色を付けるメンバー */
const CAST_COLOR_EXTRAS = [
  { name: "吉武千颯",   color: "#fbbf24" },
  { name: "相良茉優",   color: "#facc15" },
  { name: "田中ちえ美", color: "#f8fafc" },
  { name: "結木ゆな",   color: "#c084fc" }
];

/** 名前 → 色のマップ（バッジ描画用） */
export const CAST_COLOR_MAP = [...PRIORITY_CAST_FILTERS, ...CAST_COLOR_EXTRAS].reduce((acc, item) => {
  acc[item.name] = item.color;
  return acc;
}, {});
