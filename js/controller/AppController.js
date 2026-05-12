/**
 * Controller: AppController
 * フィルタ状態の管理・イベント処理・Model と View の橋渡しを担う。
 *
 * Spring Boot 移行後も、データ取得先（EpisodeRepository）を差し替えるだけで
 * このクラスはそのまま動作する設計にしている。
 */

import {
  fetchEpisodes,
  filterEpisodes,
  sortEpisodes,
  buildRanking
} from "../model/EpisodeRepository.js";

import {
  loadFavorites,
  loadWatched,
  toggleFavorite,
  toggleWatched
} from "../model/UserPreferences.js";

import { renderEpisodeList } from "../view/EpisodeListView.js";
import { renderRankingSection } from "../view/RankingView.js";

import {
  PRIORITY_CAST_FILTERS,
  UNIT_FILTERS,
  MAX_AND_CAST_SELECTION
} from "../constants.js";

import {
  applyExtendedEpisodeSearch,
  isExtendedDiscoveryActive,
  SEARCH_CATEGORY,
  SEARCH_PRESETS
} from "../model/episodeSearch.js";

export default class AppController {
  constructor() {
    // --- DOM 参照 ---
    this.castQuickFilters        = document.getElementById("castQuickFilters");
    this.unitQuickFilters        = document.getElementById("unitQuickFilters");
    this.resetFiltersButton      = document.getElementById("resetFiltersButton");
    this.sortSelect              = document.getElementById("sortSelect");
    this.rankingSection          = document.getElementById("rankingSection");
    this.rankingTitle            = document.getElementById("rankingTitle");
    this.rankingList             = document.getElementById("rankingList");
    this.toggleRankingButton     = document.getElementById("toggleRankingButton");
    this.resultTitle             = document.getElementById("resultTitle");
    this.episodeList             = document.getElementById("episodeList");
    this.resultCount             = document.getElementById("resultCount");
    this.castSelectionNotice     = document.getElementById("castSelectionNotice");
    this.episodeResultsCollapsible = document.getElementById("episodeResultsCollapsible");
    this.toggleEpisodeListButton = document.getElementById("toggleEpisodeListButton");
    this.favoritesFilterButton   = document.getElementById("favoritesFilterButton");
    this.watchedFilterButton     = document.getElementById("watchedFilterButton");
    this.unwatchedFilterButton   = document.getElementById("unwatchedFilterButton");
    this.otherVideoFilterButton  = document.getElementById("otherVideoFilterButton");

    this.globalSearchInput       = document.getElementById("globalSearchInput");
    this.searchCategorySelect    = document.getElementById("searchCategorySelect");
    this.clearGlobalSearchButton = document.getElementById("clearGlobalSearchButton");
    this.presetChipBar           = document.getElementById("presetChipBar");

    // ランキング View に渡す DOM まとめ
    this.rankingElements = {
      rankingSection:  this.rankingSection,
      rankingList:     this.rankingList,
      rankingTitle:    this.rankingTitle,
      toggleButton:    this.toggleRankingButton
    };

    // --- フィルタ状態 ---
    this.allEpisodes           = [];
    this.isRankingVisible      = false;
    this.isEpisodeListVisible  = false;
    this.lastRenderHadFilter   = false;
    this.quickFilterKeyword    = "";
    this.andFilterNames        = [];
    this.activeUnitFilterKey   = "";
    this.isOtherVideoFilterActive = false;
    this.isFavoritesFilterActive  = false;
    this.watchedFilterMode     = ""; // "" | "watched" | "unwatched"
    this.isUnitSectionExpanded = false;

    this.freeQuery             = "";
    this.searchCategoryId      = SEARCH_CATEGORY.ALL;
    this.activePresetKey       = "";
  }

  // -------------------------------------------------------------------------
  // 初期化
  // -------------------------------------------------------------------------

  async init() {
    try {
      this.allEpisodes = await fetchEpisodes();
      this._renderCastQuickFilters();
      this._renderUnitQuickFilters();
      this._renderPresetChipBar();
      this._bindEvents();
      this.render();
    } catch (error) {
      this.episodeList.innerHTML = "<li class='empty-message'>データの読み込みに失敗しました。</li>";
      this.resultCount.textContent = "";
      this.rankingList.innerHTML = "<li>ランキングを表示できませんでした</li>";
      this.episodeResultsCollapsible.classList.remove("hidden");
      this.toggleEpisodeListButton.classList.add("hidden");
      console.error(error);
    }
  }

  // -------------------------------------------------------------------------
  // イベント登録
  // -------------------------------------------------------------------------

  _bindEvents() {
    this.sortSelect.addEventListener("change", () => this.render());

    this.toggleRankingButton.addEventListener("click", () => {
      this.isRankingVisible = !this.isRankingVisible;
      this.render();
    });

    this.toggleEpisodeListButton.addEventListener("click", () => {
      this.isEpisodeListVisible = !this.isEpisodeListVisible;
      this.render();
    });

    this.resetFiltersButton.addEventListener("click", () => this._resetFilters());

    this.favoritesFilterButton?.addEventListener("click", () => {
      this.isFavoritesFilterActive = !this.isFavoritesFilterActive;
      this.render();
    });

    this.watchedFilterButton?.addEventListener("click", () => {
      this.watchedFilterMode = this.watchedFilterMode === "watched" ? "" : "watched";
      this.render();
    });

    this.unwatchedFilterButton?.addEventListener("click", () => {
      this.watchedFilterMode = this.watchedFilterMode === "unwatched" ? "" : "unwatched";
      this.render();
    });

    this.otherVideoFilterButton?.addEventListener("click", () => {
      this.isOtherVideoFilterActive = !this.isOtherVideoFilterActive;
      this.render();
    });

    this.globalSearchInput?.addEventListener("input", () => {
      this.freeQuery = String(this.globalSearchInput.value || "");
      this.render();
    });

    this.clearGlobalSearchButton?.addEventListener("click", () => {
      this.freeQuery = "";
      if (this.globalSearchInput) {
        this.globalSearchInput.value = "";
      }
      this.render();
    });

    this.searchCategorySelect?.addEventListener("change", () => {
      this.searchCategoryId = String(this.searchCategorySelect.value || SEARCH_CATEGORY.ALL);
      this.render();
    });
  }

  _renderPresetChipBar() {
    if (!this.presetChipBar) return;
    this.presetChipBar.innerHTML = SEARCH_PRESETS.map(
      (p) =>
        `<button type="button" class="preset-chip-button" data-preset-key="${p.key}">
          ${p.label}
        </button>`
    ).join("");
    this.presetChipBar.querySelectorAll(".preset-chip-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.presetKey || "";
        this.activePresetKey = this.activePresetKey === key ? "" : key;
        this.render();
      });
    });
  }

  // -------------------------------------------------------------------------
  // フィルタボタン描画
  // -------------------------------------------------------------------------

  _renderCastQuickFilters() {
    const yuisaku = UNIT_FILTERS.find((u) => u.key === "yuisaku");
    const yuisakuBtn = yuisaku ? `
      <button type="button" class="unit-filter-button"
        data-unit-key="${yuisaku.key}"
        style="--unit-color: ${yuisaku.color};"
      >${yuisaku.label}</button>
    ` : "";

    const castButtonsHtml = PRIORITY_CAST_FILTERS.map((item) => `
      <button type="button" class="cast-filter-button"
        data-filter-key="${item.name}"
        style="--cast-color: ${item.color};"
      >${item.name}</button>
    `).join("");

    this.castQuickFilters.innerHTML = `
      <div class="cast-buttons-wrap">${castButtonsHtml}${yuisakuBtn}</div>
    `;

    this.castQuickFilters.querySelectorAll(".cast-filter-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._handleQuickFilterClick(btn.dataset.filterKey || "");
        this.render();
      });
    });

    this.castQuickFilters.querySelectorAll(".unit-filter-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const selected = btn.dataset.unitKey || "";
        this.activeUnitFilterKey = this.activeUnitFilterKey === selected ? "" : selected;
        this.quickFilterKeyword = "";
        this.andFilterNames = [];
        this.render();
      });
    });
  }

  _renderUnitQuickFilters() {
    const units = UNIT_FILTERS.filter((u) => u.key !== "yuisaku");
    const makeBtn = (unit) => `
      <button type="button" class="unit-filter-button"
        data-unit-key="${unit.key}"
        style="--unit-color: ${unit.color};"
      >${unit.label}</button>
    `;

    this.unitQuickFilters.innerHTML = `
      <div class="filter-group-header">
        <span class="filter-group-label">ユニット / グループ</span>
        <button type="button" class="unit-more-toggle" id="unitMoreToggle">
          ${this.isUnitSectionExpanded ? "閉じる ▴" : "もっと見る ▾"}
        </button>
      </div>
      <div class="unit-more-wrap${this.isUnitSectionExpanded ? "" : " hidden"}">
        ${units.map(makeBtn).join("")}
      </div>
    `;

    this.unitQuickFilters.querySelectorAll(".unit-filter-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const selected = btn.dataset.unitKey || "";
        this.activeUnitFilterKey = this.activeUnitFilterKey === selected ? "" : selected;
        this.quickFilterKeyword = "";
        this.andFilterNames = [];
        this.render();
      });
    });

    document.getElementById("unitMoreToggle")?.addEventListener("click", () => {
      this.isUnitSectionExpanded = !this.isUnitSectionExpanded;
      this._renderUnitQuickFilters();
      this._updateActiveUnitFilter();
    });
  }

  _handleQuickFilterClick(filterKey) {
    if (!filterKey) return;
    this.activeUnitFilterKey = "";
    const idx = this.andFilterNames.indexOf(filterKey);
    if (idx >= 0) {
      this.andFilterNames.splice(idx, 1);
    } else if (this.andFilterNames.length < MAX_AND_CAST_SELECTION) {
      this.andFilterNames.push(filterKey);
    }
    this.quickFilterKeyword = this.andFilterNames.length === 1 ? this.andFilterNames[0] : "";
  }

  // -------------------------------------------------------------------------
  // メイン描画ループ
  // -------------------------------------------------------------------------

  render() {
    const discoveryActiveUi = this._isDiscoveryUiActive();
    const hasFilter = this._isAnyFilterActive();
    if (!this.lastRenderHadFilter && hasFilter) this.isEpisodeListVisible = true;
    if (this.lastRenderHadFilter && !hasFilter) this.isEpisodeListVisible = false;
    this.lastRenderHadFilter = hasFilter;

    const keyword    = this.quickFilterKeyword;
    const isAndMode  = this.andFilterNames.length >= 2;
    const isUnitMode = Boolean(this.activeUnitFilterKey);
    const hideRanking =
      isAndMode || isUnitMode || this.isOtherVideoFilterActive || discoveryActiveUi;
    const sortOrder  = this.sortSelect.value;

    const favorites = loadFavorites();
    const watched   = loadWatched();

    const filteredEpisodes = filterEpisodes(
      this.allEpisodes,
      keyword,
      this.andFilterNames,
      this.activeUnitFilterKey,
      this.isFavoritesFilterActive,
      favorites,
      this.watchedFilterMode,
      watched,
      this.isOtherVideoFilterActive,
      UNIT_FILTERS
    );

    const extOpts = {
      freeText: this.freeQuery,
      categoryId: this.searchCategoryId,
      presetKey: this.activePresetKey,
      unitFilters: UNIT_FILTERS
    };
    const { episodes: narrowedEpisodes, hitLabelsByVideoId } = applyExtendedEpisodeSearch(
      filteredEpisodes,
      extOpts
    );

    const sortedEpisodes = sortEpisodes(narrowedEpisodes, sortOrder);
    const ranking = buildRanking(narrowedEpisodes, keyword, this.quickFilterKeyword, PRIORITY_CAST_FILTERS);

    // View に描画を委譲
    renderEpisodeList(
      this.episodeList,
      sortedEpisodes,
      isAndMode,
      favorites,
      watched,
      (videoId) => {
        toggleFavorite(videoId);
        this.render();
      },
      (videoId) => {
        toggleWatched(videoId);
        this.render();
      },
      hitLabelsByVideoId
    );
    renderRankingSection(this.rankingElements, ranking, keyword, hideRanking, this.isRankingVisible);

    this._renderResultTitle(isAndMode, hasFilter);
    this._renderResultCount(sortedEpisodes.length, hasFilter);
    this._updateActiveQuickFilter();
    this._updateActiveUnitFilter();
    this._updateResetButtonVisibility();
    this._updateCastSelectionNotice();
    this._updateEpisodeResultsVisibility();
    this._updatePresetChipHighlight();
    this._updateFavoritesFilterButton();
    this._updateWatchedFilterButtons();
    this._updateOtherVideoFilterButton();
  }

  // -------------------------------------------------------------------------
  // 結果タイトル・件数
  // -------------------------------------------------------------------------

  _renderResultTitle(isAndMode, hasFilter) {
    if (!hasFilter) {
      this.resultTitle.textContent = "動画一覧";
      return;
    }
    if (isAndMode) {
      this.resultTitle.textContent = "検索に指定した出演者をすべて含む放送回（最大5人）";
      return;
    }
    if (this.isFavoritesFilterActive) {
      this.resultTitle.textContent = "お気に入りの放送回";
      return;
    }
    if (this.isOtherVideoFilterActive) {
      this.resultTitle.textContent = "その他の動画（総集編・耐久）";
      return;
    }
    this.resultTitle.textContent = "検索結果";
  }

  _renderResultCount(count, hasFilter) {
    const label = hasFilter ? "検索結果" : "動画一覧";
    this.resultCount.textContent = `${label}: ${count}件`;
  }

  // -------------------------------------------------------------------------
  // UI 状態の更新
  // -------------------------------------------------------------------------

  _isAnyFilterActive() {
    return (
      this.andFilterNames.length > 0 ||
      Boolean(this.quickFilterKeyword) ||
      Boolean(this.activeUnitFilterKey) ||
      this.isFavoritesFilterActive ||
      Boolean(this.watchedFilterMode) ||
      this.isOtherVideoFilterActive ||
      this._isDiscoveryUiActive()
    );
  }

  _isDiscoveryUiActive() {
    return isExtendedDiscoveryActive({
      freeText: this.freeQuery,
      categoryId: this.searchCategoryId,
      presetKey: this.activePresetKey
    });
  }

  _updatePresetChipHighlight() {
    if (!this.presetChipBar) return;
    this.presetChipBar.querySelectorAll(".preset-chip-button").forEach((btn) => {
      const key = btn.dataset.presetKey || "";
      btn.classList.toggle("is-active", Boolean(this.activePresetKey) && key === this.activePresetKey);
    });
  }

  _updateEpisodeResultsVisibility() {
    if (!this.episodeResultsCollapsible) return;
    this.episodeResultsCollapsible.classList.toggle("hidden", !this.isEpisodeListVisible);
    this.toggleEpisodeListButton.textContent = this.isEpisodeListVisible ? "閉じる" : "表示する";
  }

  _updateActiveQuickFilter() {
    this.castQuickFilters.querySelectorAll(".cast-filter-button").forEach((btn) => {
      const key = btn.dataset.filterKey || "";
      const isActive = this.andFilterNames.includes(key);
      const shouldDisable = this.andFilterNames.length >= MAX_AND_CAST_SELECTION && !isActive;
      btn.classList.toggle("is-active", isActive);
      btn.disabled = shouldDisable;
      btn.classList.toggle("is-disabled", shouldDisable);
    });
  }

  _updateActiveUnitFilter() {
    const shouldDisable = this.andFilterNames.length > 0;
    [this.castQuickFilters, this.unitQuickFilters].forEach((container) => {
      container.querySelectorAll(".unit-filter-button").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.unitKey === this.activeUnitFilterKey);
        btn.disabled = shouldDisable;
        btn.classList.toggle("is-disabled", shouldDisable);
      });
    });
  }

  _updateResetButtonVisibility() {
    const shouldShow =
      this.andFilterNames.length > 0 ||
      Boolean(this.quickFilterKeyword) ||
      Boolean(this.activeUnitFilterKey) ||
      Boolean(this.freeQuery.trim()) ||
      this.searchCategoryId !== SEARCH_CATEGORY.ALL ||
      Boolean(this.activePresetKey);
    this.resetFiltersButton.classList.toggle("hidden", !shouldShow);
  }

  _updateCastSelectionNotice() {
    if (!this.castSelectionNotice) return;
    this.castSelectionNotice.classList.toggle("hidden", this.andFilterNames.length < MAX_AND_CAST_SELECTION);
  }

  _updateFavoritesFilterButton() {
    if (!this.favoritesFilterButton) return;
    this.favoritesFilterButton.classList.toggle("is-active", this.isFavoritesFilterActive);
    this.favoritesFilterButton.textContent = this.isFavoritesFilterActive ? "♥ お気に入り表示中" : "♡ お気に入り";
  }

  _updateWatchedFilterButtons() {
    this.watchedFilterButton?.classList.toggle("is-active", this.watchedFilterMode === "watched");
    this.unwatchedFilterButton?.classList.toggle("is-active", this.watchedFilterMode === "unwatched");
  }

  _updateOtherVideoFilterButton() {
    if (!this.otherVideoFilterButton) return;
    this.otherVideoFilterButton.classList.toggle("is-active", this.isOtherVideoFilterActive);
    this.otherVideoFilterButton.textContent = this.isOtherVideoFilterActive
      ? "📼 その他の動画 表示中"
      : "📼 その他の動画";
  }

  _resetFilters() {
    this.andFilterNames        = [];
    this.quickFilterKeyword    = "";
    this.activeUnitFilterKey   = "";
    this.isFavoritesFilterActive  = false;
    this.watchedFilterMode     = "";
    this.isOtherVideoFilterActive = false;

    this.freeQuery             = "";
    this.searchCategoryId      = SEARCH_CATEGORY.ALL;
    this.activePresetKey       = "";
    if (this.globalSearchInput) {
      this.globalSearchInput.value = "";
    }
    if (this.searchCategorySelect) {
      this.searchCategorySelect.value = SEARCH_CATEGORY.ALL;
    }
    this.render();
  }
}
