/**
 * 拡張検索（Excel 由来メタ、プリセット、カテゴリ別フリーワード）とヒット理由生成。
 */

import {
  normalizeSearchText,
  getAllCastMembers,
  isPublicRecordingTitle,
  extractYoutubeVideoId
} from "./EpisodeRepository.js";

export const SEARCH_CATEGORY = {
  ALL: "all",
  CAST: "cast",
  SONG: "song",
  CORNER: "corner",
  LIVE: "liveImpression",
  EVENT: "eventImpression",
  ANIME: "animeImpression",
  BIRTHDAY: "birthday",
  PUBLIC_RECORDING: "publicRecording",
  TAG: "miscTag"
};

export const SEARCH_CATEGORY_OPTIONS = [
  { id: SEARCH_CATEGORY.ALL, label: "すべて（横断）" },
  { id: SEARCH_CATEGORY.CAST, label: "出演者" },
  { id: SEARCH_CATEGORY.SONG, label: "楽曲（リクエスト曲）" },
  { id: SEARCH_CATEGORY.CORNER, label: "コーナー" },
  { id: SEARCH_CATEGORY.LIVE, label: "ライブ感想" },
  { id: SEARCH_CATEGORY.EVENT, label: "イベント感想" },
  { id: SEARCH_CATEGORY.ANIME, label: "アニメ感想" },
  { id: SEARCH_CATEGORY.BIRTHDAY, label: "誕生日祝い" },
  { id: SEARCH_CATEGORY.PUBLIC_RECORDING, label: "公開録音" },
  { id: SEARCH_CATEGORY.TAG, label: "タグ・備考" }
];

export const SEARCH_PRESETS = [
  { key: "live_reaction", label: "ライブ感想回" },
  { key: "anime_reaction", label: "アニメ感想回" },
  { key: "public_recording", label: "公開録音回" },
  { key: "birthday", label: "誕生日祝い回" },
  { key: "yuisaku", label: "ゆいさく回" },
  { key: "gen3_join", label: "3期生加入関連" },
  { key: "ijigen_fes", label: "異次元フェス関連" }
];

const TYPE_LABEL_HIT = {
  liveImpression: "ライブ感想",
  eventImpression: "イベント感想",
  animeImpression: "アニメ感想",
  birthday: "誕生日祝い",
  incident: "備考・事件系",
  externalShow: "外部番組・メディア",
  eventName: "イベント名",
  netaTag: "タグ",
  animeSeasonTag: "タグ",
  miscTag: "タグ・備考"
};

const TAG_CATEGORY_TYPES = new Set([
  "netaTag",
  "animeSeasonTag",
  "eventName",
  "incident",
  "externalShow"
]);

/**
 * 「一覧には出さないが検索ヒットとして理由行を出したい」種別／フラグ。
 */
export function shouldShowHitReasonForTag(tag) {
  if (!tag?.searchable) return false;
  if (
    ["liveImpression", "eventImpression", "animeImpression", "birthday", "incident", "externalShow", "eventName"].includes(
      tag.type
    )
  ) {
    return true;
  }
  if (tag.visibleInList === false) return true;
  return false;
}

function truncateSnippet(text, max = 36) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function tagsOf(episode) {
  const m = episode.manualMeta;
  return Array.isArray(m?.tags) ? m.tags : [];
}

/** @param {string} categoryId */
export function episodeHasCategorySignals(episode, categoryId) {
  const meta = episode.manualMeta || {};
  const flags = meta.flags || {};
  switch (categoryId) {
    case SEARCH_CATEGORY.ALL:
      return true;
    case SEARCH_CATEGORY.CAST:
      return getAllCastMembers(episode).length > 0;
    case SEARCH_CATEGORY.SONG:
      return Boolean(meta.lunchTimeRequestSong || flags.hasLunchSong);
    case SEARCH_CATEGORY.CORNER:
      return Boolean((meta.corners || []).length || flags.hasCorner);
    case SEARCH_CATEGORY.LIVE:
      return Boolean(flags.hasLiveImpression);
    case SEARCH_CATEGORY.EVENT:
      return Boolean(flags.hasEventImpression);
    case SEARCH_CATEGORY.ANIME:
      return Boolean(flags.hasAnimeImpression);
    case SEARCH_CATEGORY.BIRTHDAY:
      return Boolean(flags.hasBirthdayTag);
    case SEARCH_CATEGORY.PUBLIC_RECORDING:
      return isPublicRecordingTitle(episode.title || "");
    case SEARCH_CATEGORY.TAG:
      return tagsOf(episode).some((t) => TAG_CATEGORY_TYPES.has(t.type));
    default:
      return true;
  }
}

/** @param {string} categoryId */
function tagsForCategoryFilter(episode, categoryId) {
  const tags = tagsOf(episode);
  switch (categoryId) {
    case SEARCH_CATEGORY.ALL:
      return tags.filter((t) => t.searchable);
    case SEARCH_CATEGORY.SONG:
      return tags.filter((t) => t.type === "lunchSong" && t.searchable);
    case SEARCH_CATEGORY.CORNER:
      return tags.filter((t) => t.type === "corner" && t.searchable);
    case SEARCH_CATEGORY.LIVE:
      return tags.filter((t) => t.type === "liveImpression" && t.searchable);
    case SEARCH_CATEGORY.EVENT:
      return tags.filter(
        (t) => ["eventImpression", "eventName", "externalShow"].includes(t.type) && t.searchable
      );
    case SEARCH_CATEGORY.ANIME:
      return tags.filter((t) => t.type === "animeImpression" && t.searchable);
    case SEARCH_CATEGORY.BIRTHDAY:
      return tags.filter((t) => t.type === "birthday" && t.searchable);
    case SEARCH_CATEGORY.TAG:
      return tags.filter((t) => TAG_CATEGORY_TYPES.has(t.type) && t.searchable);
    case SEARCH_CATEGORY.PUBLIC_RECORDING:
      return [];
    case SEARCH_CATEGORY.CAST:
      return [];
    default:
      return [];
  }
}

/** @returns {string[]} */
export function searchableStringsForCategory(episode, categoryId) {
  const chunks = [];

  const title = episode.title || "";
  const casts = getAllCastMembers(episode);

  switch (categoryId) {
    case SEARCH_CATEGORY.ALL:
      chunks.push(title, ...casts);
      tagsOf(episode)
        .filter((t) => t.searchable)
        .forEach((t) => chunks.push(t.name));
      break;
    case SEARCH_CATEGORY.CAST:
      chunks.push(...casts);
      break;
    case SEARCH_CATEGORY.PUBLIC_RECORDING:
      chunks.push(title);
      break;
    case SEARCH_CATEGORY.TAG:
      tagsForCategoryFilter(episode, categoryId).forEach((t) => chunks.push(t.name));
      break;
    default:
      tagsForCategoryFilter(episode, categoryId).forEach((t) => chunks.push(t.name));
      if (categoryId === SEARCH_CATEGORY.CORNER) {
        const meta = episode.manualMeta || {};
        (meta.corners || []).forEach((c) => chunks.push(c));
      }
      if (categoryId === SEARCH_CATEGORY.SONG) {
        const song = episode.manualMeta?.lunchTimeRequestSong;
        if (song) chunks.push(song);
      }
      break;
  }

  return chunks.map((x) => String(x));
}

/** @returns {boolean} */
function textMatchesHaystack(normQuery, haystack) {
  if (!normQuery) return true;
  return haystack.some((raw) => normalizeSearchText(raw).includes(normQuery));
}

/** @returns {boolean} */
export function presetMatchesEpisode(episode, presetKey, unitFilters) {
  const meta = episode.manualMeta || {};
  const flags = meta.flags || {};
  switch (presetKey) {
    case "":
      return true;
    case "live_reaction":
      return Boolean(flags.hasLiveImpression);
    case "anime_reaction":
      return Boolean(flags.hasAnimeImpression);
    case "birthday":
      return Boolean(flags.hasBirthdayTag);
    case "public_recording":
      return isPublicRecordingTitle(episode.title || "");
    case "gen3_join":
      return Boolean(flags.mentionsGen3Join);
    case "ijigen_fes":
      return Boolean(flags.mentionsIjigenFes);
    case "yuisaku": {
      const u = unitFilters.find((x) => x.key === "yuisaku");
      if (!u) return false;
      const cm = episode.castMembers || getAllCastMembers(episode);
      return u.members.every((name) => cm.includes(name));
    }
    default:
      return false;
  }
}

/**
 * 検索クエリがヒットしたタグだけから「一致: ○○」文言を組み立てる。
 * @returns {string[]}
 */
export function computeHitLabels(episode, normQuery, categoryId) {
  if (!normQuery) return [];

  /** @type {string[]} */
  const out = [];

  const tagPool =
    categoryId === SEARCH_CATEGORY.ALL
      ? tagsOf(episode).filter((t) => t.searchable)
      : tagsForCategoryFilter(episode, categoryId);

  for (const tag of tagPool) {
    if (!normalizeSearchText(tag.name).includes(normQuery)) continue;
    if (!shouldShowHitReasonForTag(tag)) continue;
    const labelKey = TYPE_LABEL_HIT[tag.type] || "タグ・備考";
    out.push(`一致: ${labelKey}「${truncateSnippet(tag.name)}」`);
  }

  if (categoryId === SEARCH_CATEGORY.PUBLIC_RECORDING || categoryId === SEARCH_CATEGORY.ALL) {
    const pub = normalizeSearchText(episode.title || "");
    if (pub.includes(normQuery) && isPublicRecordingTitle(episode.title || "")) {
      const already = out.some((l) => l.includes("公開録音"));
      if (!already) {
        out.push(`一致: 公開録音（タイトル）「${truncateSnippet(episode.title, 42)}」`);
      }
    }
  }

  return out;
}

/**
 * クエリおよびカテゴリに基づきエピソードがヒットするか。
 */
export function episodeMatchesFreeSection(episode, normQuery, categoryId) {
  if (!normQuery) return true;
  if (categoryId === SEARCH_CATEGORY.PUBLIC_RECORDING) {
    return normalizeSearchText(episode.title || "").includes(normQuery);
  }

  const strings = searchableStringsForCategory(episode, categoryId);
  return textMatchesHaystack(normQuery, strings);
}

/**
 * preset / カテゴリ次元 / フリーワードを適用した配列と、ヒット理由ラベルを返す。
 *
 * @param {object[]} episodes 既に出演者フィルタ等を通過したエピソード配列（castMembers 付き）
 * @param {object} opts
 */
export function applyExtendedEpisodeSearch(episodes, opts) {
  const {
    freeText = "",
    categoryId = SEARCH_CATEGORY.ALL,
    presetKey = "",
    unitFilters = []
  } = opts;

  const normQuery = normalizeSearchText(String(freeText || "").trim());
  const hasQuery = Boolean(normQuery);

  /** @type {Map<string, string[]>} */
  const hitMap = new Map();

  let out = episodes.slice();

  if (presetKey) {
    out = out.filter((ep) => presetMatchesEpisode(ep, presetKey, unitFilters));
  }

  const categoryOnlyMode = !hasQuery && categoryId !== SEARCH_CATEGORY.ALL;

  if (categoryOnlyMode) {
    out = out.filter((ep) => episodeHasCategorySignals(ep, categoryId));
  }

  if (hasQuery) {
    out = out.filter((ep) => episodeMatchesFreeSection(ep, normQuery, categoryId));
    out.forEach((ep) => {
      const id = extractYoutubeVideoId(ep.youtubeUrl);
      const labels = computeHitLabels(ep, normQuery, categoryId);
      if (id && labels.length) hitMap.set(id, labels);
    });
  }

  return { episodes: out, hitLabelsByVideoId: hitMap };
}

/**
 * 「拠点になっているだけの状態」があるかどうか（一覧を自動オープンするか等）。
 */
export function isExtendedDiscoveryActive(opts) {
  const t = String(opts.freeText || "").trim();
  if (t) return true;
  if (opts.categoryId && opts.categoryId !== SEARCH_CATEGORY.ALL) return true;
  if (opts.presetKey) return true;
  return false;
}
