/**
 * episodeMeta.manualMeta から、ファセット第二階層の候補リストを構築する。
 */

import { normalizeSearchText } from "./EpisodeRepository.js";
import { BIRTHDAY_CAST_ORDER } from "../constants.js";

const LIELLA_DIARY_PREFIX = "Li絵lla!日記";
const LIELLA_SPECIAL_PREFIX = "Li絵lla!日記スペシャル";

/**
 * @typedef {{
 *   corners: string[],
 *   liveImpressions: string[],
 *   events: string[],
 *   animeImpressions: string[],
 *   incidents: string[],
 *   birthdayCastNames: string[],
 *   publicRecordingMemos: string[],
 *   liellaDiaryCasts: string[]
 * }} FacetCatalog
 */

const PUBLIC_REC_TEXT_RE = /\u516c\u958b\u9332\u97f3|\u516c\u9332/;

/** 備考・タグ文言として「公開録音」とみなせるもの */
function isPublicRecordingMemoTag(tag) {
  if (!tag) return false;
  if (tag.type === "publicRecordingNote") return true;
  return PUBLIC_REC_TEXT_RE.test(String(tag.name || ""));
}

/** @param {Map<string,string>} bucket */
function sortedUniqueValues(bucket) {
  return [...bucket.values()].sort((a, b) => a.localeCompare(b, "ja"));
}

/** BIRTHDAY_CAST_ORDER 順にソートし、未定義の名前は末尾にアルファベット順で追加 */
function sortByCastOrder(names) {
  return [...names].sort((a, b) => {
    const ia = BIRTHDAY_CAST_ORDER.indexOf(a);
    const ib = BIRTHDAY_CAST_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, "ja");
  });
}

/** @param {Map<string,string>} bucket @param {string} raw */
function addLabel(bucket, raw) {
  const text = String(raw ?? "").trim();
  if (!text) return;
  const key = normalizeSearchText(text);
  if (!key) return;
  if (!bucket.has(key)) {
    bucket.set(key, text);
  }
}

/**
 * @param {object[]} episodes
 * @returns {FacetCatalog}
 */
export function buildFacetCatalog(episodes) {
  /** @type {Map<string,string>} */
  const corners = new Map();
  /** @type {Map<string,string>} */
  const lives = new Map();
  /** @type {Map<string,string>} */
  const events = new Map();
  /** @type {Map<string,string>} */
  const animes = new Map();
  /** @type {Map<string,string>} */
  const incidents = new Map();
  /** @type {Map<string,string>} */
  const publicRecordingMemos = new Map();
  /** @type {Map<string,string>} */
  const birthdays = new Map();
  /** @type {Set<string>} Li絵lla!日記に登場するキャスト名 */
  const liellaDiaryCastsSet = new Set();
  let hasLiellaDiary = false;

  for (const episode of episodes) {
    const meta = episode.manualMeta || {};

    for (const c of meta.corners || []) {
      if (String(c).startsWith(LIELLA_SPECIAL_PREFIX)) {
        addLabel(corners, LIELLA_SPECIAL_PREFIX);
      } else if (String(c).startsWith(LIELLA_DIARY_PREFIX)) {
        hasLiellaDiary = true;
        const colonIdx = String(c).indexOf(":");
        if (colonIdx !== -1) {
          String(c).slice(colonIdx + 1).split("、").forEach((s) => {
            const name = s.trim();
            if (name) liellaDiaryCastsSet.add(name);
          });
        }
      } else {
        addLabel(corners, c);
      }
    }

    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    for (const tag of tags) {
      const name = tag?.name || "";
      if (isPublicRecordingMemoTag(tag)) {
        addLabel(publicRecordingMemos, name);
      }

      switch (tag.type) {
        case "corner": {
          if (String(name).startsWith(LIELLA_SPECIAL_PREFIX)) {
            addLabel(corners, LIELLA_SPECIAL_PREFIX);
          } else if (String(name).startsWith(LIELLA_DIARY_PREFIX)) {
            hasLiellaDiary = true;
            const colonIdx = String(name).indexOf(":");
            if (colonIdx !== -1) {
              String(name).slice(colonIdx + 1).split("、").forEach((s) => {
                const n = s.trim();
                if (n) liellaDiaryCastsSet.add(n);
              });
            }
          } else {
            addLabel(corners, name);
          }
          break;
        }
        case "liveImpression":
          addLabel(lives, name);
          break;
        case "eventImpression":
        case "eventName":
        case "externalShow":
          addLabel(events, name);
          break;
        case "animeImpression":
          addLabel(animes, name);
          break;
        case "incident":
          addLabel(incidents, name);
          break;
        case "birthday":
          addLabel(birthdays, name);
          break;
        default:
          break;
      }
    }
  }

  // Li絵lla!日記 を先頭に、スペシャルを2番目に固定
  if (hasLiellaDiary) {
    const hasSpecial = corners.has(normalizeSearchText(LIELLA_SPECIAL_PREFIX));
    corners.delete(normalizeSearchText(LIELLA_SPECIAL_PREFIX));
    const sorted = sortedUniqueValues(corners);
    corners.clear();
    corners.set(normalizeSearchText(LIELLA_DIARY_PREFIX), LIELLA_DIARY_PREFIX);
    if (hasSpecial) {
      corners.set(normalizeSearchText(LIELLA_SPECIAL_PREFIX), LIELLA_SPECIAL_PREFIX);
    }
    for (const v of sorted) {
      corners.set(normalizeSearchText(v), v);
    }
  }

  const birthdayCastNames = sortByCastOrder([...birthdays.values()]);
  const liellaDiaryCasts = sortByCastOrder([...liellaDiaryCastsSet]);

  return {
    corners:             [...corners.values()],
    liveImpressions:     sortedUniqueValues(lives),
    events:              sortedUniqueValues(events),
    animeImpressions:    sortedUniqueValues(animes),
    incidents:           sortedUniqueValues(incidents),
    publicRecordingMemos: sortedUniqueValues(publicRecordingMemos),
    birthdayCastNames,
    liellaDiaryCasts
  };
}
