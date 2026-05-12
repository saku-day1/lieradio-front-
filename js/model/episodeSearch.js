/**
 * 拡張検索：親ファセット＋（楽曲のみ）部分一致。
 * 出演者は担当外。プリセットも扱わない。
 */

import { normalizeSearchText, isPublicRecordingTitle, extractYoutubeVideoId } from "./EpisodeRepository.js";

/** 親ファセット（検索しない＝値なし） */
export const FACET_PRIMARY_NONE = "";

export const SEARCH_CATEGORY = {
  SONG: "song",
  CORNER: "corner",
  LIVE: "liveImpression",
  EVENT: "eventImpression",
  ANIME: "animeImpression",
  BIRTHDAY: "birthday",
  PUBLIC_RECORDING: "publicRecording",
  INCIDENT: "incident"
};

const TAG_EVENT_TYPES = new Set(["eventImpression", "eventName", "externalShow"]);

const PUBLIC_REC_TEXT_RE = /\u516c\u958b\u9332\u97f3|\u516c\u9332/;

function tagsOf(episode) {
  const m = episode.manualMeta;
  return Array.isArray(m?.tags) ? m.tags : [];
}

function truncateSnippet(text, max = 40) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function isPublicRecordingTag(tag) {
  if (!tag) return false;
  if (tag.type === "publicRecordingNote") return true;
  return PUBLIC_REC_TEXT_RE.test(String(tag.name || ""));
}

/** タイトルまたは備考・タグに公開録音の記載がある */
export function episodeHasPublicRecordingMention(episode) {
  if (isPublicRecordingTitle(episode.title || "")) return true;
  if (episode.manualMeta?.flags?.mentionsPublicRecordingInRemark) return true;
  return tagsOf(episode).some((t) => isPublicRecordingTag(t));
}

/** @param {string} categoryId */
export function episodeHasCategorySignals(episode, categoryId) {
  const meta = episode.manualMeta || {};
  const flags = meta.flags || {};
  switch (categoryId) {
    case SEARCH_CATEGORY.SONG:
      return Boolean(meta.lunchTimeRequestSong || flags.hasLunchSong);
    case SEARCH_CATEGORY.CORNER:
      return Boolean((meta.corners || []).length || flags.hasCorner);
    case SEARCH_CATEGORY.LIVE:
      return Boolean(flags.hasLiveImpression);
    case SEARCH_CATEGORY.EVENT:
      return tagsOf(episode).some((t) => TAG_EVENT_TYPES.has(t.type));
    case SEARCH_CATEGORY.ANIME:
      return Boolean(flags.hasAnimeImpression);
    case SEARCH_CATEGORY.BIRTHDAY:
      return Boolean(flags.hasBirthdayTag);
    case SEARCH_CATEGORY.PUBLIC_RECORDING:
      return episodeHasPublicRecordingMention(episode);
    case SEARCH_CATEGORY.INCIDENT:
      return tagsOf(episode).some((t) => t.type === "incident");
    default:
      return true;
  }
}

function cornerStrings(episode) {
  const meta = episode.manualMeta || {};
  const fromMeta = Array.isArray(meta.corners) ? meta.corners : [];
  const fromTags = tagsOf(episode)
    .filter((t) => t.type === "corner")
    .map((t) => t.name);
  return [...fromMeta, ...fromTags].map((x) => String(x));
}

function tagNamesByTypes(episode, types) {
  const set = new Set(types);
  return tagsOf(episode)
    .filter((t) => set.has(t.type))
    .map((t) => String(t.name || ""));
}

function normEq(a, b) {
  return normalizeSearchText(a) === normalizeSearchText(b);
}

/**
 * 第二階層の値で絞り込み。
 * @param {string} facetPrimary
 * @param {string} rawValue
 */
export function episodeMatchesFacetSecondary(episode, facetPrimary, rawValue) {
  const needle = String(rawValue || "").trim();
  if (!needle) return true;

  switch (facetPrimary) {
    case "corner":
      return cornerStrings(episode).some((t) => normEq(t, needle));
    case "liveImpression":
      return tagNamesByTypes(episode, ["liveImpression"]).some((t) => normEq(t, needle));
    case "eventImpression":
      return tagNamesByTypes(episode, [...TAG_EVENT_TYPES]).some((t) => normEq(t, needle));
    case "animeImpression":
      return tagNamesByTypes(episode, ["animeImpression"]).some((t) => normEq(t, needle));
    case "incident":
      return tagNamesByTypes(episode, ["incident"]).some((t) => normEq(t, needle));
    case "publicRecording":
      return tagsOf(episode).some((t) => isPublicRecordingTag(t) && normEq(String(t.name || ""), needle));
    case "birthday": {
      const castNorm = normalizeSearchText(needle);
      return tagsOf(episode)
        .filter((t) => t.type === "birthday")
        .some((t) => normalizeSearchText(t.name).includes(castNorm));
    }
    default:
      return true;
  }
}

function categoryForFacet(facetPrimary) {
  switch (facetPrimary) {
    case "corner":
      return SEARCH_CATEGORY.CORNER;
    case "liveImpression":
      return SEARCH_CATEGORY.LIVE;
    case "eventImpression":
      return SEARCH_CATEGORY.EVENT;
    case "animeImpression":
      return SEARCH_CATEGORY.ANIME;
    case "birthday":
      return SEARCH_CATEGORY.BIRTHDAY;
    case "incident":
      return SEARCH_CATEGORY.INCIDENT;
    case "lunchSong":
      return SEARCH_CATEGORY.SONG;
    case "publicRecording":
      return SEARCH_CATEGORY.PUBLIC_RECORDING;
    default:
      return null;
  }
}

function collectLunchHaystack(episode) {
  const meta = episode.manualMeta || {};
  const chunks = [];
  if (meta.lunchTimeRequestSong) chunks.push(meta.lunchTimeRequestSong);
  tagsOf(episode)
    .filter((t) => t.type === "lunchSong")
    .forEach((t) => chunks.push(t.name));
  return chunks.map((x) => String(x));
}

/**
 * @param {object[]} episodes
 * @param {object} opts
 */
export function applyFacetDiscoveryFilter(episodes, opts) {
  const { facetPrimary = FACET_PRIMARY_NONE, facetSecondaryValue = "", songPartialQuery = "" } = opts;

  /** @type {Map<string, string[]>} */
  const hitMap = new Map();

  let out = episodes.slice();

  // ファセット絞り込み（楽曲は独立入力欄で処理するためスキップ）
  if (facetPrimary && facetPrimary !== "lunchSong") {
    if (facetPrimary === "publicRecording") {
      out = out.filter((episode) => episodeHasPublicRecordingMention(episode));
      const secondaryTrim = String(facetSecondaryValue || "").trim();
      if (secondaryTrim) {
        out = out.filter((episode) => episodeMatchesFacetSecondary(episode, "publicRecording", secondaryTrim));
      }
    } else {
      const categoryHint = categoryForFacet(facetPrimary);
      if (categoryHint) {
        const secondaryTrim = String(facetSecondaryValue || "").trim();
        if (!secondaryTrim) {
          out = out.filter((episode) => episodeHasCategorySignals(episode, categoryHint));
        } else {
          out = out.filter((episode) => episodeMatchesFacetSecondary(episode, facetPrimary, secondaryTrim));
        }
      }
    }
  }

  // 楽曲キーワード絞り込み（ファセット選択と独立して常時適用）
  const normSong = normalizeSearchText(String(songPartialQuery || "").trim());
  if (normSong) {
    out = out.filter((episode) => {
      const hay = collectLunchHaystack(episode);
      const match = hay.find((text) => normalizeSearchText(text).includes(normSong));
      if (!match) return false;
      const vid = extractYoutubeVideoId(episode.youtubeUrl);
      if (vid) {
        hitMap.set(vid, [`一致: リクエスト曲「${truncateSnippet(match, 52)}」`]);
      }
      return true;
    });
  }

  return { episodes: out, hitLabelsByVideoId: hitMap };
}

/** @returns {boolean} */
export function isFacetDiscoveryActive(opts) {
  const primary = String(opts.facetPrimary ?? "");
  const sec = String(opts.facetSecondaryValue ?? "").trim();
  const sq = String(opts.songPartialQuery ?? "").trim();
  return Boolean(primary || sec || sq);
}
