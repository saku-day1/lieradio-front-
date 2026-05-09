"use strict";

// 取得した全エピソードデータを保持する
let allEpisodes = [];

// DOMをまとめて取得しておく（毎回querySelectorしないため）
const castQuickFilters = document.getElementById("castQuickFilters");
const unitQuickFilters = document.getElementById("unitQuickFilters");
const resetFiltersButton = document.getElementById("resetFiltersButton");
const sortSelect = document.getElementById("sortSelect");
const rankingSection = document.getElementById("rankingSection");
const rankingTitle = document.getElementById("rankingTitle");
const rankingList = document.getElementById("rankingList");
const toggleRankingButton = document.getElementById("toggleRankingButton");
const resultTitle = document.getElementById("resultTitle");
const episodeList = document.getElementById("episodeList");
const resultCount = document.getElementById("resultCount");
const castSelectionNotice = document.getElementById("castSelectionNotice");
const episodeResultsCollapsible = document.getElementById("episodeResultsCollapsible");
const toggleEpisodeListButton = document.getElementById("toggleEpisodeListButton");
const favoritesFilterButton = document.getElementById("favoritesFilterButton");
let isRankingVisible = false;
let isEpisodeListVisible = false;
let lastRenderHadFilter = false;
let quickFilterKeyword = "";
let andFilterNames = [];
let activeUnitFilterKey = "";

const PRIORITY_CAST_FILTERS = [
  { name: "伊達さゆり", color: "#f39c12" }, // オレンジ
  { name: "Liyuu", color: "#5bc0de" }, // 水色
  { name: "岬なこ", color: "#ff7eb6" }, // ピンク
  { name: "ペイトン尚未", color: "#4caf50" }, // 緑
  { name: "青山なぎさ", color: "#3b82f6" }, // 青
  { name: "鈴原希実", color: "#facc15" }, // 黄色
  { name: "薮島朱音", color: "#ef4444" }, // 赤
  { name: "大熊和奏", color: "#f8fafc" }, // 白
  { name: "絵森彩", color: "#ff9ed1" }, // ピンク
  { name: "結那", color: "#a855f7" }, // 紫
  { name: "坂倉花", color: "#22c55e" } // 緑
];
const MAX_AND_CAST_SELECTION = 5;
const UNIT_FILTERS = [
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
  { key: "catchu", label: "CatChu!", color: "#ef4444", members: ["伊達さゆり", "ペイトン尚未", "薮島朱音"] },
  { key: "kaleidoscore", label: "KALEIDOSCORE", color: "#3b82f6", members: ["Liyuu", "青山なぎさ", "結那"] },
  { key: "syncri5e", label: "5yncri5e!", color: "#facc15", members: ["岬なこ", "鈴原希実", "大熊和奏", "絵森彩", "坂倉花"] },
  { key: "team-kodomo", label: "チームこども", color: "#ef4444", members: ["伊達さゆり", "Liyuu", "鈴原希実", "絵森彩"] },
  { key: "team-sports", label: "チームスポーツ", color: "#3b82f6", members: ["岬なこ", "ペイトン尚未", "薮島朱音", "結那"] },
  { key: "team-midori", label: "チームみどり", color: "#22c55e", members: ["青山なぎさ", "大熊和奏", "坂倉花"] },
  { key: "yuisaku", label: "ゆいさく", color: "#ff7eb6", members: ["結那", "坂倉花"] },
  { key: "sunnypassion", label: "Sunny Passion", color: "#f59e0b", members: ["吉武千颯", "結木ゆな"] },
  { key: "nijigasaki", label: "虹ヶ咲", color: "#fde047", members: ["相良茉優", "田中ちえ美"] }
];
const FAVORITES_KEY = "lieradio_favorites";
let isFavoritesFilterActive = false;

// ページ初期化
init();

async function init() {
  try {
    allEpisodes = await fetchEpisodes();
    renderCastQuickFilters();
    renderUnitQuickFilters();
    bindEvents();
    render();
  } catch (error) {
    episodeList.innerHTML = "<li class='empty-message'>データの読み込みに失敗しました。</li>";
    resultCount.textContent = "";
    rankingList.innerHTML = "<li>ランキングを表示できませんでした</li>";
    episodeResultsCollapsible.classList.remove("hidden");
    toggleEpisodeListButton.classList.add("hidden");
    console.error(error);
  }
}

// データを取得して返す
// 1) /api/episodes (サーバーレス) を優先
// 2) 失敗した場合はローカルJSONへフォールバック
async function fetchEpisodes() {
  try {
    const apiResponse = await fetch("./api/episodes");
    if (apiResponse.ok) {
      return apiResponse.json();
    }
  } catch (error) {
    // API未起動などはローカルJSONで継続する
    console.warn("API fetch failed. Fallback to local JSON.", error);
  }

  const localResponse = await fetch("./data/episodes.json");
  if (!localResponse.ok) {
    throw new Error(`Fetch failed: ${localResponse.status}`);
  }

  return localResponse.json();
}

// 入力値変更イベントを登録
function bindEvents() {
  sortSelect.addEventListener("change", render);
  toggleRankingButton.addEventListener("click", toggleRankingVisibility);
  toggleEpisodeListButton.addEventListener("click", toggleEpisodeListVisibility);
  resetFiltersButton.addEventListener("click", resetFilters);
  if (favoritesFilterButton) {
    favoritesFilterButton.addEventListener("click", () => {
      isFavoritesFilterActive = !isFavoritesFilterActive;
      render();
    });
  }
}

function isAnyFilterActive() {
  return (
    andFilterNames.length > 0 ||
    Boolean(quickFilterKeyword) ||
    Boolean(activeUnitFilterKey) ||
    isFavoritesFilterActive
  );
}

function renderCastQuickFilters() {
  castQuickFilters.innerHTML = PRIORITY_CAST_FILTERS.map((item) => `
    <button
      type="button"
      class="cast-filter-button"
      data-filter-key="${item.name}"
      style="--cast-color: ${item.color};"
    >
      ${item.name}
    </button>
  `).join("");

  castQuickFilters.querySelectorAll(".cast-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      const filterKey = button.dataset.filterKey || "";
      handleQuickFilterClick(filterKey);
      render();
    });
  });
}

function renderUnitQuickFilters() {
  unitQuickFilters.innerHTML = UNIT_FILTERS.map((unit) => `
    <button
      type="button"
      class="unit-filter-button"
      data-unit-key="${unit.key}"
      style="--unit-color: ${unit.color};"
    >
      ${unit.label}
    </button>
  `).join("");

  unitQuickFilters.querySelectorAll(".unit-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.unitKey || "";
      activeUnitFilterKey = activeUnitFilterKey === selected ? "" : selected;
      quickFilterKeyword = "";
      andFilterNames = [];
      render();
    });
  });
}

function handleQuickFilterClick(filterKey) {
  if (!filterKey) {
    return;
  }

  activeUnitFilterKey = "";

  const existingIndex = andFilterNames.indexOf(filterKey);
  if (existingIndex >= 0) {
    andFilterNames.splice(existingIndex, 1);
  } else if (andFilterNames.length < MAX_AND_CAST_SELECTION) {
    andFilterNames.push(filterKey);
  }

  quickFilterKeyword = andFilterNames.length === 1 ? andFilterNames[0] : "";
}

// 画面の再描画を1つの関数にまとめる
function render() {
  const hasFilter = isAnyFilterActive();
  if (!lastRenderHadFilter && hasFilter) {
    isEpisodeListVisible = true;
  }
  if (lastRenderHadFilter && !hasFilter) {
    isEpisodeListVisible = false;
  }
  lastRenderHadFilter = hasFilter;

  const keyword = quickFilterKeyword;
  const isAndMode = andFilterNames.length >= 2;
  const isUnitMode = Boolean(activeUnitFilterKey);
  const hideRanking = isAndMode || isUnitMode;
  const sortOrder = sortSelect.value;

  const favorites = loadFavorites();
  const filteredEpisodes = filterEpisodes(allEpisodes, keyword, andFilterNames, activeUnitFilterKey, isFavoritesFilterActive, favorites);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes, keyword);

  renderEpisodeList(sortedEpisodes, isAndMode, favorites);
  renderRankingSection(ranking, keyword, hideRanking);
  renderResultTitle(isAndMode, hasFilter);
  renderResultCount(sortedEpisodes.length, hasFilter);
  updateActiveQuickFilter();
  updateActiveUnitFilter();
  updateResetButtonVisibility();
  updateCastSelectionNotice();
  updateEpisodeResultsVisibility();
  updateFavoritesFilterButton();
}

// 出演者（メインMC + ゲスト）の部分一致検索
// APIデータに castMembers が無い場合は mainCast + guests を結合して扱う
function filterEpisodes(episodes, keyword, andNames = [], unitKey = "", favoritesOnly = false, favorites = new Set()) {
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

  if (unitKey) {
    const unit = UNIT_FILTERS.find((item) => item.key === unitKey);
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

// 公開日で新しい順 / 古い順に並べ替える
function sortEpisodes(episodes, sortOrder) {
  return [...episodes].sort((a, b) => {
    const timeA = new Date(a.publishedAt).getTime();
    const timeB = new Date(b.publishedAt).getTime();
    return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
  });
}

// castMembersを集計してランキング配列を作る
function buildRanking(episodes, keyword = "") {
  const excludedNames = getExcludedRankingNames(keyword);
  const countMap = episodes.reduce((acc, episode) => {
    episode.castMembers.forEach((member) => {
      if (excludedNames.has(member)) {
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

function getExcludedRankingNames(keyword) {
  if (!keyword) {
    return new Set();
  }

  if (quickFilterKeyword) {
    return new Set([quickFilterKeyword]);
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  const matched = PRIORITY_CAST_FILTERS
    .map((item) => item.name)
    .filter((name) => normalizeSearchText(name) === normalizedKeyword);

  return new Set(matched);
}

function renderEpisodeList(episodes, isAndMode = false, favorites = new Set()) {
  if (episodes.length === 0) {
    episodeList.innerHTML = "<li class='empty-message'>該当する放送回がありません。</li>";
    return;
  }

  episodeList.innerHTML = episodes
    .map((episode) => {
      const castMembers = getAllCastMembers(episode);
      const displayedNumber = episode.broadcastNumber ?? episode.episodeNumber;
      const titleText = isAndMode
        ? episode.title
        : formatEpisodeHeading(displayedNumber, episode.title);

      const videoId = extractYoutubeVideoId(episode.youtubeUrl);
      const thumbUrl = getThumbnailUrl(videoId);
      const safeTitle = escapeHtml(titleText);
      const safeYoutubeUrl = escapeHtml(episode.youtubeUrl || "");
      const safePublishedAt = escapeHtml(episode.publishedAt || "");
      const isFav = videoId ? favorites.has(videoId) : false;

      const thumbHtml = thumbUrl
        ? `
          <a class="episode-thumb" href="${safeYoutubeUrl}" target="_blank" rel="noopener noreferrer" aria-label="YouTubeで「${safeTitle}」を見る">
            <img
              src="${thumbUrl}"
              alt=""
              loading="lazy"
              decoding="async"
              width="320"
              height="180"
            >
            <span class="episode-thumb-play" aria-hidden="true">▶</span>
          </a>
        `
        : "";

      const castBadgesHtml = renderCastBadgesHtml(castMembers);
      const unitBadgesHtml = renderUnitBadgesHtml(castMembers);
      const favBtn = videoId
        ? `<button type="button" class="fav-button${isFav ? " is-fav" : ""}" data-video-id="${videoId}" aria-label="${isFav ? "お気に入りを解除" : "お気に入りに追加"}" aria-pressed="${isFav}">${isFav ? "♥" : "♡"}</button>`
        : "";

      return `
        <li class="episode-item">
          <div class="episode-item-layout">
            ${thumbHtml}
            <div class="episode-content">
              <div class="episode-title-row">
                <h3>${safeTitle}</h3>
                ${favBtn}
              </div>
              <div class="cast-badges" aria-label="出演者">${castBadgesHtml}</div>
              ${unitBadgesHtml ? `<div class="unit-badges" aria-label="ユニット">${unitBadgesHtml}</div>` : ""}
              <p class="meta">公開日: ${safePublishedAt}</p>
              <a href="${safeYoutubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a>
            </div>
          </div>
        </li>
      `;
    })
    .join("");

  episodeList.querySelectorAll(".fav-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const videoId = btn.dataset.videoId;
      if (!videoId) return;
      toggleFavorite(videoId);
      render();
    });
  });
}

// 出演者バッジ群のHTMLを生成する。プライオリティに含まれる人はその色、それ以外はグレー。
function renderCastBadgesHtml(castMembers) {
  if (!Array.isArray(castMembers) || castMembers.length === 0) {
    return `<span class="cast-fallback">出演者情報未設定</span>`;
  }

  if (castMembers.length === 1 && castMembers[0] === "出演者情報未設定") {
    return `<span class="cast-fallback">出演者情報未設定</span>`;
  }

  return castMembers
    .map((name) => {
      const safeName = escapeHtml(name);
      const color = getCastColor(name);
      if (color) {
        // CSSのbackgroundに値を直接渡すため、念のためダブルクォートをエスケープしておく
        const safeColor = String(color).replace(/"/g, "");
        return `<span class="cast-badge" style="--cast-color: ${safeColor};">${safeName}</span>`;
      }
      return `<span class="cast-badge cast-badge--others">${safeName}</span>`;
    })
    .join("");
}

// 出演メンバーから全員揃っているユニットを検出してバッジHTMLを返す
function renderUnitBadgesHtml(castMembers) {
  const castSet = new Set(castMembers);
  return UNIT_FILTERS
    .filter((unit) => unit.members.every((m) => castSet.has(m)))
    .map((unit) => {
      const safeLabel = escapeHtml(unit.label);
      const safeColor = String(unit.color).replace(/"/g, "");
      return `<span class="unit-badge" style="--unit-color: ${safeColor};">${safeLabel}</span>`;
    })
    .join("");
}

function formatEpisodeHeading(displayedNumber, rawTitle) {
  const title = String(rawTitle || "").trim();
  if (!title) {
    return `第${displayedNumber}回`;
  }

  // 公開録音回は先頭に回数を付与せず、タイトルをそのまま表示する。
  if (isPublicRecordingTitle(title)) {
    return title;
  }

  const hasEpisodeLabel = /(第\s*\d+\s*回|#\s*\d+)/i.test(title);
  if (hasEpisodeLabel) {
    // タイトル中に回数表記がある場合は、先頭への回数付与をしない。
    // 先頭の「第◯回」が重複しているときは先頭側を落とす。
    const duplicateLeading = title.match(/^第\s*(\d+)\s*回\s*(.+)$/);
    if (duplicateLeading) {
      const number = duplicateLeading[1];
      const rest = duplicateLeading[2].trim();
      const hasSameLabelLater = new RegExp(`(第\\s*${number}\\s*回|#\\s*${number})`, "i").test(rest);
      if (hasSameLabelLater) {
        return rest;
      }
    }
    return title;
  }

  return `第${displayedNumber}回 ${title}`;
}

function isPublicRecordingTitle(title) {
  return /公開録音|公録/.test(title);
}

function renderRanking(ranking) {
  if (ranking.length === 0) {
    rankingList.innerHTML = "<li>該当データなし</li>";
    return;
  }

  rankingList.innerHTML = ranking
    .map((item) => `<li>${item.name}（${item.count}回）</li>`)
    .join("");
}

function renderRankingTitle(keyword) {
  if (!keyword) {
    rankingTitle.textContent = "出演回数ランキング";
    return;
  }

  rankingTitle.textContent = `${keyword}の共演者ランキング`;
}

function renderRankingSection(ranking, keyword, hideRanking) {
  if (hideRanking) {
    rankingSection.classList.add("hidden");
    return;
  }

  rankingSection.classList.remove("hidden");
  renderRanking(ranking);
  renderRankingTitle(keyword);
  rankingList.classList.toggle("hidden", !isRankingVisible);
  toggleRankingButton.textContent = isRankingVisible ? "閉じる" : "表示する";
}

function renderResultTitle(isAndMode, hasFilter) {
  if (!hasFilter) {
    resultTitle.textContent = "動画一覧";
    return;
  }
  if (isAndMode) {
    resultTitle.textContent = "検索に指定した出演者をすべて含む放送回（最大5人）";
    return;
  }
  if (isFavoritesFilterActive) {
    resultTitle.textContent = "お気に入りの放送回";
    return;
  }
  resultTitle.textContent = "検索結果";
}

function renderResultCount(count, hasFilter) {
  const label = hasFilter ? "検索結果" : "動画一覧";
  resultCount.textContent = `${label}: ${count}件`;
}

function toggleRankingVisibility() {
  isRankingVisible = !isRankingVisible;
  render();
}

function toggleEpisodeListVisibility() {
  isEpisodeListVisible = !isEpisodeListVisible;
  render();
}

function updateEpisodeResultsVisibility() {
  if (!episodeResultsCollapsible) {
    return;
  }
  episodeResultsCollapsible.classList.toggle("hidden", !isEpisodeListVisible);
  toggleEpisodeListButton.textContent = isEpisodeListVisible ? "閉じる" : "表示する";
}

function updateActiveQuickFilter() {
  castQuickFilters.querySelectorAll(".cast-filter-button").forEach((button) => {
    const key = button.dataset.filterKey || "";
    const isActive = andFilterNames.includes(key);
    const shouldDisable =
      andFilterNames.length >= MAX_AND_CAST_SELECTION && !isActive;

    button.classList.toggle("is-active", isActive);
    button.disabled = shouldDisable;
    button.classList.toggle("is-disabled", shouldDisable);
  });
}

function updateActiveUnitFilter() {
  const shouldDisable = andFilterNames.length > 0;
  unitQuickFilters.querySelectorAll(".unit-filter-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.unitKey === activeUnitFilterKey);
    button.disabled = shouldDisable;
    button.classList.toggle("is-disabled", shouldDisable);
  });
}

function updateResetButtonVisibility() {
  const shouldShow =
    andFilterNames.length > 0 ||
    Boolean(quickFilterKeyword) ||
    Boolean(activeUnitFilterKey);
  resetFiltersButton.classList.toggle("hidden", !shouldShow);
}

function updateCastSelectionNotice() {
  if (!castSelectionNotice) {
    return;
  }
  castSelectionNotice.classList.toggle("hidden", andFilterNames.length < MAX_AND_CAST_SELECTION);
}

function updateFavoritesFilterButton() {
  if (!favoritesFilterButton) return;
  favoritesFilterButton.classList.toggle("is-active", isFavoritesFilterActive);
  favoritesFilterButton.textContent = isFavoritesFilterActive ? "♥ お気に入り表示中" : "♡ お気に入り";
}

function resetFilters() {
  andFilterNames = [];
  quickFilterKeyword = "";
  activeUnitFilterKey = "";
  isFavoritesFilterActive = false;
  render();
}

function getAllCastMembers(episode) {
  if (Array.isArray(episode.castMembers) && episode.castMembers.length > 0) {
    return episode.castMembers;
  }

  const mainCast = Array.isArray(episode.mainCast) ? episode.mainCast : [];
  const guests = Array.isArray(episode.guests) ? episode.guests : [];
  const merged = [...mainCast, ...guests];

  return merged.length > 0 ? [...new Set(merged)] : ["出演者情報未設定"];
}

function normalizeSearchText(text) {
  return String(text).replace(/\s+/g, "").toLowerCase();
}

// お気に入り: localStorageへの読み書き
function loadFavorites() {
  try {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch {
    return new Set();
  }
}

function toggleFavorite(videoId) {
  const favorites = loadFavorites();
  if (favorites.has(videoId)) {
    favorites.delete(videoId);
  } else {
    favorites.add(videoId);
  }
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    // localStorage が使えない環境では無視
  }
}

// PRIORITY_CAST_FILTERS から名前 → 色のマップを一度だけ構築する
const CAST_COLOR_MAP = PRIORITY_CAST_FILTERS.reduce((acc, item) => {
  acc[item.name] = item.color;
  return acc;
}, {});

// YouTubeのURLからvideoIdを取り出す。許可されている文字以外は弾く（XSS/混入対策）
function extractYoutubeVideoId(url) {
  if (typeof url !== "string") {
    return "";
  }
  const match = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return match ? match[1] : "";
}

// サムネイルURLを返す。videoIdが取れないときは空文字
function getThumbnailUrl(videoId) {
  if (!videoId) {
    return "";
  }
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

// 出演者バッジの背景色（PRIORITYに無い人はnull = グレーで描画）
function getCastColor(name) {
  return CAST_COLOR_MAP[name] || null;
}

// innerHTML経由で名前等を出すため、最低限のHTMLエスケープを行う
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
