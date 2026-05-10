"use strict";

import {
  fetchEpisodes,
  filterEpisodes,
  sortEpisodes,
  buildRanking,
  extractYoutubeVideoId
} from "./js/model/EpisodeRepository.js";

import {
  loadFavorites,
  loadWatched,
  toggleFavorite,
  toggleWatched
} from "./js/model/UserPreferences.js";

import { renderEpisodeList } from "./js/view/EpisodeListView.js";
import { renderRankingSection } from "./js/view/RankingView.js";

import {
  PRIORITY_CAST_FILTERS,
  UNIT_FILTERS,
  MAX_AND_CAST_SELECTION
} from "./js/constants.js";

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
const watchedFilterButton = document.getElementById("watchedFilterButton");
const unwatchedFilterButton = document.getElementById("unwatchedFilterButton");
const otherVideoFilterButton = document.getElementById("otherVideoFilterButton");

// フィルタ状態
let isRankingVisible = false;
let isEpisodeListVisible = false;
let lastRenderHadFilter = false;
let quickFilterKeyword = "";
let andFilterNames = [];
let activeUnitFilterKey = "";
let isOtherVideoFilterActive = false;
let isFavoritesFilterActive = false;
let watchedFilterMode = ""; // "" | "watched" | "unwatched"
let isUnitSectionExpanded = false;

// ランキングView用にDOM要素をまとめる
const rankingElements = {
  rankingSection,
  rankingList,
  rankingTitle,
  toggleButton: toggleRankingButton
};

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

// 入力値変更イベントを登録
function bindEvents() {
  sortSelect.addEventListener("change", render);
  toggleRankingButton.addEventListener("click", () => {
    isRankingVisible = !isRankingVisible;
    render();
  });
  toggleEpisodeListButton.addEventListener("click", () => {
    isEpisodeListVisible = !isEpisodeListVisible;
    render();
  });
  resetFiltersButton.addEventListener("click", resetFilters);
  if (favoritesFilterButton) {
    favoritesFilterButton.addEventListener("click", () => {
      isFavoritesFilterActive = !isFavoritesFilterActive;
      render();
    });
  }
  if (watchedFilterButton) {
    watchedFilterButton.addEventListener("click", () => {
      watchedFilterMode = watchedFilterMode === "watched" ? "" : "watched";
      render();
    });
  }
  if (unwatchedFilterButton) {
    unwatchedFilterButton.addEventListener("click", () => {
      watchedFilterMode = watchedFilterMode === "unwatched" ? "" : "unwatched";
      render();
    });
  }
  if (otherVideoFilterButton) {
    otherVideoFilterButton.addEventListener("click", () => {
      isOtherVideoFilterActive = !isOtherVideoFilterActive;
      render();
    });
  }
}

function isAnyFilterActive() {
  return (
    andFilterNames.length > 0 ||
    Boolean(quickFilterKeyword) ||
    Boolean(activeUnitFilterKey) ||
    isFavoritesFilterActive ||
    Boolean(watchedFilterMode) ||
    isOtherVideoFilterActive
  );
}

function renderCastQuickFilters() {
  const yuisaku = UNIT_FILTERS.find((u) => u.key === "yuisaku");
  const yuisakuBtn = yuisaku ? `
    <button
      type="button"
      class="unit-filter-button"
      data-unit-key="${yuisaku.key}"
      style="--unit-color: ${yuisaku.color};"
    >${yuisaku.label}</button>
  ` : "";

  const castButtonsHtml = PRIORITY_CAST_FILTERS.map((item) => `
    <button
      type="button"
      class="cast-filter-button"
      data-filter-key="${item.name}"
      style="--cast-color: ${item.color};"
    >
      ${item.name}
    </button>
  `).join("");

  castQuickFilters.innerHTML = `
    <div class="cast-buttons-wrap">${castButtonsHtml}${yuisakuBtn}</div>
  `;

  castQuickFilters.querySelectorAll(".cast-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      handleQuickFilterClick(button.dataset.filterKey || "");
      render();
    });
  });

  castQuickFilters.querySelectorAll(".unit-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.unitKey || "";
      activeUnitFilterKey = activeUnitFilterKey === selected ? "" : selected;
      quickFilterKeyword = "";
      andFilterNames = [];
      render();
    });
  });
}

function renderUnitQuickFilters() {
  const units = UNIT_FILTERS.filter((u) => u.key !== "yuisaku");

  const makeBtn = (unit) => `
    <button
      type="button"
      class="unit-filter-button"
      data-unit-key="${unit.key}"
      style="--unit-color: ${unit.color};"
    >${unit.label}</button>
  `;

  unitQuickFilters.innerHTML = `
    <div class="filter-group-header">
      <span class="filter-group-label">ユニット / グループ</span>
      <button type="button" class="unit-more-toggle" id="unitMoreToggle">
        ${isUnitSectionExpanded ? "閉じる ▴" : "もっと見る ▾"}
      </button>
    </div>
    <div class="unit-more-wrap${isUnitSectionExpanded ? "" : " hidden"}">
      ${units.map(makeBtn).join("")}
    </div>
  `;

  unitQuickFilters.querySelectorAll(".unit-filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.unitKey || "";
      activeUnitFilterKey = activeUnitFilterKey === selected ? "" : selected;
      quickFilterKeyword = "";
      andFilterNames = [];
      render();
    });
  });

  document.getElementById("unitMoreToggle")?.addEventListener("click", () => {
    isUnitSectionExpanded = !isUnitSectionExpanded;
    renderUnitQuickFilters();
    updateActiveUnitFilter();
  });
}

function handleQuickFilterClick(filterKey) {
  if (!filterKey) return;

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
  if (!lastRenderHadFilter && hasFilter) isEpisodeListVisible = true;
  if (lastRenderHadFilter && !hasFilter) isEpisodeListVisible = false;
  lastRenderHadFilter = hasFilter;

  const keyword = quickFilterKeyword;
  const isAndMode = andFilterNames.length >= 2;
  const isUnitMode = Boolean(activeUnitFilterKey);
  const hideRanking = isAndMode || isUnitMode || isOtherVideoFilterActive;
  const sortOrder = sortSelect.value;

  const favorites = loadFavorites();
  const watched = loadWatched();

  const filteredEpisodes = filterEpisodes(
    allEpisodes,
    keyword,
    andFilterNames,
    activeUnitFilterKey,
    isFavoritesFilterActive,
    favorites,
    watchedFilterMode,
    watched,
    isOtherVideoFilterActive,
    UNIT_FILTERS
  );
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes, keyword, quickFilterKeyword, PRIORITY_CAST_FILTERS);

  // View に描画を委譲
  renderEpisodeList(
    episodeList,
    sortedEpisodes,
    isAndMode,
    favorites,
    watched,
    (videoId) => { toggleFavorite(videoId); render(); },
    (videoId) => { toggleWatched(videoId); render(); }
  );
  renderRankingSection(rankingElements, ranking, keyword, hideRanking, isRankingVisible);

  renderResultTitle(isAndMode, hasFilter);
  renderResultCount(sortedEpisodes.length, hasFilter);
  updateActiveQuickFilter();
  updateActiveUnitFilter();
  updateResetButtonVisibility();
  updateCastSelectionNotice();
  updateEpisodeResultsVisibility();
  updateFavoritesFilterButton();
  updateWatchedFilterButtons();
  updateOtherVideoFilterButton();
}

// ---------------------------------------------------------------------------
// 結果タイトル・件数表示
// ---------------------------------------------------------------------------

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
  if (isOtherVideoFilterActive) {
    resultTitle.textContent = "その他の動画（総集編・耐久）";
    return;
  }
  resultTitle.textContent = "検索結果";
}

function renderResultCount(count, hasFilter) {
  const label = hasFilter ? "検索結果" : "動画一覧";
  resultCount.textContent = `${label}: ${count}件`;
}

// ---------------------------------------------------------------------------
// UI 状態の更新（アクティブ表示・ボタン状態など）
// ---------------------------------------------------------------------------

function updateEpisodeResultsVisibility() {
  if (!episodeResultsCollapsible) return;
  episodeResultsCollapsible.classList.toggle("hidden", !isEpisodeListVisible);
  toggleEpisodeListButton.textContent = isEpisodeListVisible ? "閉じる" : "表示する";
}

function updateActiveQuickFilter() {
  castQuickFilters.querySelectorAll(".cast-filter-button").forEach((button) => {
    const key = button.dataset.filterKey || "";
    const isActive = andFilterNames.includes(key);
    const shouldDisable = andFilterNames.length >= MAX_AND_CAST_SELECTION && !isActive;
    button.classList.toggle("is-active", isActive);
    button.disabled = shouldDisable;
    button.classList.toggle("is-disabled", shouldDisable);
  });
}

function updateActiveUnitFilter() {
  const shouldDisable = andFilterNames.length > 0;
  [castQuickFilters, unitQuickFilters].forEach((container) => {
    container.querySelectorAll(".unit-filter-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.unitKey === activeUnitFilterKey);
      button.disabled = shouldDisable;
      button.classList.toggle("is-disabled", shouldDisable);
    });
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
  if (!castSelectionNotice) return;
  castSelectionNotice.classList.toggle("hidden", andFilterNames.length < MAX_AND_CAST_SELECTION);
}

function updateFavoritesFilterButton() {
  if (!favoritesFilterButton) return;
  favoritesFilterButton.classList.toggle("is-active", isFavoritesFilterActive);
  favoritesFilterButton.textContent = isFavoritesFilterActive ? "♥ お気に入り表示中" : "♡ お気に入り";
}

function updateWatchedFilterButtons() {
  if (watchedFilterButton) {
    watchedFilterButton.classList.toggle("is-active", watchedFilterMode === "watched");
  }
  if (unwatchedFilterButton) {
    unwatchedFilterButton.classList.toggle("is-active", watchedFilterMode === "unwatched");
  }
}

function updateOtherVideoFilterButton() {
  if (!otherVideoFilterButton) return;
  otherVideoFilterButton.classList.toggle("is-active", isOtherVideoFilterActive);
  otherVideoFilterButton.textContent = isOtherVideoFilterActive ? "📼 その他の動画 表示中" : "📼 その他の動画";
}

function resetFilters() {
  andFilterNames = [];
  quickFilterKeyword = "";
  activeUnitFilterKey = "";
  isFavoritesFilterActive = false;
  watchedFilterMode = "";
  isOtherVideoFilterActive = false;
  render();
}
