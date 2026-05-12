/**
 * episodeMeta.manualMeta から、ファセット第二階層の候補リストを構築する。
 */

import { normalizeSearchText } from "./EpisodeRepository.js";

/**
 * @typedef {{
 *   corners: string[],
 *   liveImpressions: string[],
 *   events: string[],
 *   animeImpressions: string[],
 *   incidents: string[],
 *   birthdayCastNames: string[],
 *   publicRecordingMemos: string[]
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
 * @param {string[]} birthdayCastCandidates
 * @returns {FacetCatalog}
 */
export function buildFacetCatalog(episodes, birthdayCastCandidates) {
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

  /** @type {Set<string>} */
  const birthdayCastHits = new Set();

  const castNorms = birthdayCastCandidates
    .map((name) => ({ name: String(name).trim(), norm: normalizeSearchText(name) }))
    .filter((x) => x.name && x.norm);

  for (const episode of episodes) {
    const meta = episode.manualMeta || {};
    for (const c of meta.corners || []) addLabel(corners, c);

    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    for (const tag of tags) {
      const name = tag?.name || "";
      if (isPublicRecordingMemoTag(tag)) {
        addLabel(publicRecordingMemos, name);
      }

      switch (tag.type) {
        case "corner":
          addLabel(corners, name);
          break;
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
        case "birthday": {
          const hay = normalizeSearchText(name);
          for (const { name: castName, norm } of castNorms) {
            if (hay.includes(norm)) birthdayCastHits.add(castName);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  const birthdayCastNames = [...birthdayCastHits].sort((a, b) => a.localeCompare(b, "ja"));

  return {
    corners: sortedUniqueValues(corners),
    liveImpressions: sortedUniqueValues(lives),
    events: sortedUniqueValues(events),
    animeImpressions: sortedUniqueValues(animes),
    incidents: sortedUniqueValues(incidents),
    publicRecordingMemos: sortedUniqueValues(publicRecordingMemos),
    birthdayCastNames
  };
}
