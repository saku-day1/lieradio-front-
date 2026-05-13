/**
 * Model: EpisodeRepository
 * エピソードデータの取得・フィルタリング・ソート・ランキング集計を担当する。
 * DOM や UI には一切依存しない純粋なデータ操作層。
 *
 * 将来的に Spring Boot が生成した episodes.json に切り替える場合も、
 * fetchEpisodes() の URL を変えるだけで対応できる。
 */

/** タイトルに含まれていれば「その他の動画」と判定するキーワード */
export const OTHER_VIDEO_TITLE_KEYWORDS = ["総集編", "耐久"];

// ---------------------------------------------------------------------------
// タイトル判定ユーティリティ
// ---------------------------------------------------------------------------

export function isPublicRecordingTitle(title) {
  return /公開録音|公録/.test(title);
}

/** タイトルまたは manualMeta の publicRecordingNote タグで公開録音回を判定する */
export function isPublicRecording(episode) {
  if (isPublicRecordingTitle(episode?.title || "")) return true;
  const tags = episode?.manualMeta?.tags ?? [];
  return tags.some((t) => t.type === "publicRecordingNote");
}

export function isCompilationTitle(title) {
  return /総集編/.test(String(title || ""));
}

export function isOtherVideoTitle(title) {
  return OTHER_VIDEO_TITLE_KEYWORDS.some((kw) => String(title || "").includes(kw));
}

// ---------------------------------------------------------------------------
// 文字列ユーティリティ
// ---------------------------------------------------------------------------

/** 全角/半角統一・スペース除去・小文字化して比較用に正規化する */
export function normalizeSearchText(text) {
  return String(text).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// YouTube URL ユーティリティ
// ---------------------------------------------------------------------------

/** YouTube の URL から videoId を取り出す（XSS対策で許可文字のみ） */
export function extractYoutubeVideoId(url) {
  if (typeof url !== "string") {
    return "";
  }
  const match = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// エピソードデータユーティリティ
// ---------------------------------------------------------------------------

/**
 * エピソードから出演者リストを取得する。
 * API データに castMembers がない場合は mainCast + guests を結合する。
 */
export function getAllCastMembers(episode) {
  if (Array.isArray(episode.castMembers) && episode.castMembers.length > 0) {
    return episode.castMembers;
  }

  const mainCast = Array.isArray(episode.mainCast) ? episode.mainCast : [];
  const guests = Array.isArray(episode.guests) ? episode.guests : [];
  const merged = [...mainCast, ...guests];

  return merged.length > 0 ? [...new Set(merged)] : ["出演者情報未設定"];
}

/**
 * メタ情報（Excel 由来など）JSON を読み込む。
 * 開発時のみ存在しない場合がある。
 */
async function fetchEpisodeManualMetaOnce() {
  try {
    const response = await fetch("./data/episodeMeta.json");
    if (!response.ok) {
      return [];
    }
    return response.json();
  } catch (_error) {
    return [];
  }
}

/**
 * メタオブジェクトを videoId でエピソードへマージする。
 * videoId が未設定のメタエントリは結合せず警告を出す。
 */
export function mergeManualMetaIntoEpisodes(episodes, manualMetaRecords) {
  if (!Array.isArray(manualMetaRecords) || manualMetaRecords.length === 0) {
    return episodes;
  }

  /** @type {Map<string, object>} videoId → metaRecord */
  const map = new Map();
  for (const record of manualMetaRecords) {
    const vid = record?.videoId;
    if (typeof vid === "string" && vid.trim()) {
      if (map.has(vid)) {
        console.warn(`[episodeMeta] videoId 重複: ${vid}`);
      }
      map.set(vid, record);
    } else {
      console.warn(`[episodeMeta] videoId 未設定のエントリをスキップ:`, record?.broadcastNumber ?? record?.titleKeyword ?? "(不明)");
    }
  }

  return episodes.map((episode) => {
    const vid = extractYoutubeVideoId(episode.youtubeUrl);
    if (!vid) return { ...episode };
    const manual = map.get(vid);
    return manual ? { ...episode, manualMeta: manual } : { ...episode };
  });
}

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

/**
 * エピソードデータを取得して返す。
 * 1) /api/episodes（Vercel サーバーレス）を優先
 * 2) 失敗した場合は ./data/episodes.json へフォールバック
 *
 * 取得後、`./data/episodeMeta.json` があれば manualMeta を付与する。
 */
export async function fetchEpisodes() {
  let episodesPayload;

  try {
    const apiResponse = await fetch("./api/episodes");
    if (apiResponse.ok) {
      episodesPayload = await apiResponse.json();
    }
  } catch (error) {
    console.warn("API fetch failed. Fallback to local JSON.", error);
  }

  if (!episodesPayload) {
    const localResponse = await fetch("./data/episodes.json");
    if (!localResponse.ok) {
      throw new Error(`Fetch failed: ${localResponse.status}`);
    }
    episodesPayload = await localResponse.json();
  }

  const manualRecords = await fetchEpisodeManualMetaOnce();
  return mergeManualMetaIntoEpisodes(episodesPayload, manualRecords);
}


// ---------------------------------------------------------------------------
// フィルタリング
// ---------------------------------------------------------------------------

/**
 * 指定された条件でエピソードを絞り込む。
 *
 * @param {object[]} episodes       全エピソード
 * @param {string}   keyword        キャスト名キーワード（単一）
 * @param {string[]} andNames       AND検索キャスト名リスト
 * @param {string}   unitKey        ユニットキー
 * @param {boolean}  favoritesOnly  お気に入りのみ
 * @param {Set}      favorites      お気に入り videoId セット
 * @param {string}   watchedMode    "" | "watched" | "unwatched"
 * @param {Set}      watched        視聴済み videoId セット
 * @param {boolean}  otherVideoOnly その他の動画（耐久・総集編）のみ
 * @param {object[]} unitFilters    ユニット定義リスト（UNIT_FILTERS）
 */
export function filterEpisodes(
  episodes,
  keyword,
  andNames = [],
  unitKey = "",
  favoritesOnly = false,
  favorites = new Set(),
  watchedMode = "",
  watched = new Set(),
  otherVideoOnly = false,
  unitFilters = []
) {
  let result = episodes.map((episode) => ({
    ...episode,
    castMembers: getAllCastMembers(episode)
  }));

  if (favoritesOnly) {
    result = result.filter((episode) => {
      const videoId = extractYoutubeVideoId(episode.youtubeUrl);
      return videoId && favorites.has(videoId);
    });
  }

  if (watchedMode === "watched") {
    result = result.filter((episode) => {
      const videoId = extractYoutubeVideoId(episode.youtubeUrl);
      return videoId && watched.has(videoId);
    });
  } else if (watchedMode === "unwatched") {
    result = result.filter((episode) => {
      const videoId = extractYoutubeVideoId(episode.youtubeUrl);
      return !videoId || !watched.has(videoId);
    });
  }

  if (otherVideoOnly) {
    result = result.filter((episode) => {
      const title = String(episode.title || "");
      return OTHER_VIDEO_TITLE_KEYWORDS.some((kw) => title.includes(kw));
    });
  }

  if (unitKey) {
    const unit = unitFilters.find((item) => item.key === unitKey);
    if (!unit) {
      return result;
    }
    return result.filter((episode) =>
      unit.members.every((member) => episode.castMembers.includes(member))
    );
  }

  if (andNames.length >= 2) {
    return result.filter((episode) =>
      andNames.every((name) => episode.castMembers.includes(name))
    );
  }

  if (!keyword) {
    return result;
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  return result.filter((episode) =>
    episode.castMembers.some((member) =>
      normalizeSearchText(member).includes(normalizedKeyword)
    )
  );
}

// ---------------------------------------------------------------------------
// ソート
// ---------------------------------------------------------------------------

/** 公開日で新しい順 / 古い順に並べ替える */
export function sortEpisodes(episodes, sortOrder) {
  return [...episodes].sort((a, b) => {
    const timeA = new Date(a.publishedAt).getTime();
    const timeB = new Date(b.publishedAt).getTime();
    return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
  });
}

// ---------------------------------------------------------------------------
// ランキング集計
// ---------------------------------------------------------------------------

/**
 * 出演者ランキング配列を生成する。
 * 総集編・「出演者情報未設定」は集計対象外。
 *
 * @param {object[]} episodes            フィルタ済みエピソード
 * @param {string}   keyword             現在のキーワード
 * @param {string}   quickFilterKeyword  単一キャストフィルタ時のキーワード
 * @param {object[]} priorityCastFilters PRIORITY_CAST_FILTERS 定数
 */
export function buildRanking(episodes, keyword = "", quickFilterKeyword = "", priorityCastFilters = []) {
  const excludedNames = getExcludedRankingNames(keyword, quickFilterKeyword, priorityCastFilters);

  const countMap = episodes.reduce((acc, episode) => {
    if (isCompilationTitle(episode.title)) {
      return acc;
    }
    episode.castMembers.forEach((member) => {
      if (excludedNames.has(member) || member === "出演者情報未設定") {
        return;
      }
      acc[member] = (acc[member] || 0) + 1;
    });
    return acc;
  }, {});

  return Object.entries(countMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

export function buildSongRanking(episodes, limit = 3) {
  const countMap = {};
  for (const episode of episodes) {
    if (isCompilationTitle(episode.title)) continue;
    const meta = episode.manualMeta || {};
    const songsPerEpisode = new Set();
    if (meta.lunchTimeRequestSong) songsPerEpisode.add(meta.lunchTimeRequestSong.trim());
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    for (const tag of tags) {
      if (tag.type === "lunchSong" && tag.name) songsPerEpisode.add(tag.name.trim());
    }
    for (const song of songsPerEpisode) {
      if (song) countMap[song] = (countMap[song] || 0) + 1;
    }
  }
  return Object.entries(countMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"))
    .slice(0, limit);
}

function getExcludedRankingNames(keyword, quickFilterKeyword, priorityCastFilters) {
  if (!keyword) {
    return new Set();
  }

  if (quickFilterKeyword) {
    return new Set([quickFilterKeyword]);
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  const matched = priorityCastFilters
    .map((item) => item.name)
    .filter((name) => normalizeSearchText(name) === normalizedKeyword);

  return new Set(matched);
}
