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

import { applyFacetDiscoveryFilter, isFacetDiscoveryActive, FACET_PRIMARY_NONE } from "../model/episodeSearch.js";

import { buildFacetCatalog } from "../model/facetCatalog.js";

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

    this.toggleDiscoveryButton    = document.getElementById("toggleDiscoveryButton");
    this.discoveryContent         = document.getElementById("discoveryContent");
    this.facetPrimarySelect       = document.getElementById("facetPrimarySelect");
    this.facetSecondarySelect     = document.getElementById("facetSecondarySelect");
    this.facetSecondaryWrap       = document.getElementById("facetSecondaryWrap");
    this.facetSecondaryLabel      = document.getElementById("facetSecondaryLabel");
    this.songPartialWrap          = document.getElementById("songPartialWrap");
    this.songPartialInput         = document.getElementById("songPartialInput");
    this.clearSongPartialButton   = document.getElementById("clearSongPartialButton");

    this.cornerPickWrap           = document.getElementById("cornerPickWrap");
    this.cornerPickList           = document.getElementById("cornerPickList");
    this.cornerPickClearButton    = document.getElementById("cornerPickClearButton");
    this.liellaDiaryCastWrap      = document.getElementById("liellaDiaryCastWrap");
    this.liellaDiaryCastList      = document.getElementById("liellaDiaryCastList");
    this.animePickWrap            = document.getElementById("animePickWrap");
    this.animePickList            = document.getElementById("animePickList");
    this.animePickClearButton     = document.getElementById("animePickClearButton");
    this.resetDiscoveryButton     = document.getElementById("resetDiscoveryButton");

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

    this.facetPrimaryKey       = FACET_PRIMARY_NONE;
    this.facetSecondaryValue   = "";
    this.songPartialQuery      = "";
    this._facetCatalog         = null;
    this.isDiscoveryVisible    = false;

    this.currentPage           = 1;
    this._lastFilterKey        = "";
    this.paginationBar         = document.getElementById("paginationBar");
    this.pagePrevButton        = document.getElementById("pagePrevButton");
    this.pageNextButton        = document.getElementById("pageNextButton");
    this.pageIndicator         = document.getElementById("pageIndicator");
  }

  // -------------------------------------------------------------------------
  // 初期化
  // -------------------------------------------------------------------------

  async init() {
    try {
      this.allEpisodes = await fetchEpisodes();
      this._facetCatalog = buildFacetCatalog(this.allEpisodes);
      this._renderCastQuickFilters();
      this._renderUnitQuickFilters();
      this._populateFacetSecondaryOptions();
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
    this.resetDiscoveryButton?.addEventListener("click", () => this._resetDiscoveryFilters());

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

    this.toggleDiscoveryButton?.addEventListener("click", () => {
      this.isDiscoveryVisible = !this.isDiscoveryVisible;
      this._updateDiscoveryVisibility();
    });

    this.facetPrimarySelect?.addEventListener("change", () => this._onFacetPrimaryChange());

    this.facetSecondarySelect?.addEventListener("change", () => {
      this.facetSecondaryValue = this.facetSecondarySelect?.value || "";
      this.render();
    });

    this.songPartialInput?.addEventListener("input", () => {
      this.songPartialQuery = String(this.songPartialInput.value || "");
      this.render();
    });

    this.clearSongPartialButton?.addEventListener("click", () => {
      this.songPartialQuery = "";
      if (this.songPartialInput) {
        this.songPartialInput.value = "";
      }
      this.render();
    });

    this.cornerPickList?.addEventListener("click", (ev) => {
      const target = ev.target.closest("button.corner-pick-item");
      if (!target) return;
      const value = target.dataset.cornerPick || "";
      this.facetSecondaryValue = this.facetSecondaryValue === value ? "" : value;
      this.render();
    });

    this.cornerPickClearButton?.addEventListener("click", () => {
      this.facetSecondaryValue = "";
      this.render();
    });

    this.animePickClearButton?.addEventListener("click", () => {
      this.facetSecondaryValue = "";
      this.render();
    });

    this.pagePrevButton?.addEventListener("click", () => {
      if (this.currentPage > 1) {
        this.currentPage -= 1;
        this.render();
        this.episodeList?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    this.pageNextButton?.addEventListener("click", () => {
      this.currentPage += 1;
      this.render();
      this.episodeList?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  _onFacetPrimaryChange() {
    if (!this.facetPrimarySelect) return;
    this.facetPrimaryKey = this.facetPrimarySelect.value || FACET_PRIMARY_NONE;
    this.facetSecondaryValue = "";

    if (this.facetPrimaryKey !== "lunchSong") {
      this.songPartialQuery = "";
      if (this.songPartialInput) this.songPartialInput.value = "";
    }

    this._populateFacetSecondaryOptions();
    this.render();
  }

  /**
   * 現在の親ファセットに応じて第二プルダウンを組み替える。
   */
  _populateFacetSecondaryOptions() {
    const selectEl = this.facetSecondarySelect;
    if (!selectEl || !this._facetCatalog) return;

    const catalog = this._facetCatalog;

    /** @type {string[]} */
    let values = [];

    switch (this.facetPrimaryKey) {
      case "corner":
        selectEl.innerHTML = "";
        return;
      case "publicRecording":
        values = catalog.publicRecordingMemos;
        break;
      case "liveImpression":
        values = catalog.liveImpressions;
        break;
      case "eventImpression":
        values = catalog.events;
        break;
      case "animeImpression":
        values = catalog.animeImpressions;
        break;
      case "birthday":
        values = catalog.birthdayCastNames;
        break;
      case "incident":
        values = catalog.incidents;
        break;
      default:
        selectEl.innerHTML = "";
        return;
    }

    selectEl.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = this._facetSecondaryPlaceholderText(this.facetPrimaryKey);
    selectEl.appendChild(allOpt);

    for (const label of values) {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      selectEl.appendChild(option);
    }

    selectEl.value = "";
  }

  _facetSecondaryHeadingText(_primaryKey) {
    return "絞り込み";
  }

  _facetSecondaryPlaceholderText(primaryKey) {
    switch (primaryKey) {
      case "liveImpression":
        return "どのライブ？";
      case "eventImpression":
        return "どのイベント？";
      case "birthday":
        return "メンバーのお祝い回を選んでください";
      case "incident":
        return "どの出来事？";
      case "publicRecording":
        return "公録を選んでください";
      default:
        return "（このカテゴリのすべて）";
    }
  }

  _updateDiscoveryVisibility() {
    this.discoveryContent?.classList.toggle("hidden", !this.isDiscoveryVisible);
    if (this.toggleDiscoveryButton) {
      this.toggleDiscoveryButton.textContent = this.isDiscoveryVisible ? "閉じる" : "表示する";
    }
  }

  _updateFacetAccessoryVisibility() {
    const primary = this.facetPrimaryKey;

    const showCornerExplorer = primary === "corner";
    const showSongInput = primary === "lunchSong";
    const showAnimePick = primary === "animeImpression";
    const showSecondaryPullDown =
      Boolean(primary) && primary !== "corner" && primary !== "lunchSong" && primary !== "animeImpression";

    this.cornerPickWrap?.classList.toggle("hidden", !showCornerExplorer);
    this.facetSecondaryWrap?.classList.toggle("hidden", !showSecondaryPullDown);
    this.songPartialWrap?.classList.toggle("hidden", !showSongInput);
    this.animePickWrap?.classList.toggle("hidden", !showAnimePick);

    if (this.facetSecondaryLabel) {
      this.facetSecondaryLabel.textContent = this._facetSecondaryHeadingText(primary || "");
    }
  }

  _renderCornerPickList() {
    const root = this.cornerPickList;
    const catalog = this._facetCatalog;
    if (!root || !catalog) return;

    root.replaceChildren();

    const LIELLA_PREFIX = "Li絵lla!日記";
    const LIELLA_SPECIAL_PREFIX = "Li絵lla!日記スペシャル";
    for (const label of catalog.corners) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "corner-pick-item";
      const isLiellaSelected =
        label === LIELLA_PREFIX &&
        String(this.facetSecondaryValue).startsWith(LIELLA_PREFIX) &&
        !String(this.facetSecondaryValue).startsWith(LIELLA_SPECIAL_PREFIX);
      if (this.facetSecondaryValue === label || isLiellaSelected) {
        btn.classList.add("is-selected");
      }
      btn.dataset.cornerPick = label;
      btn.textContent = label;
      root.appendChild(btn);
    }

    this._renderLiellaDiaryCastList(catalog);
  }

  _renderAnimePickList() {
    const root = this.animePickList;
    const catalog = this._facetCatalog;
    if (!root || !catalog) return;

    root.replaceChildren();
    for (const label of catalog.animeImpressions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "corner-pick-item";
      if (this.facetSecondaryValue === label) btn.classList.add("is-selected");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        this.facetSecondaryValue = this.facetSecondaryValue === label ? "" : label;
        this.render();
      });
      root.appendChild(btn);
    }
  }

  _renderLiellaDiaryCastList(catalog) {
    const wrap = this.liellaDiaryCastWrap;
    const listEl = this.liellaDiaryCastList;
    if (!wrap || !listEl || !catalog) return;

    const LIELLA_PREFIX = "Li絵lla!日記";
    const LIELLA_SPECIAL_PREFIX = "Li絵lla!日記スペシャル";
    const liellaActive =
      String(this.facetSecondaryValue).startsWith(LIELLA_PREFIX) &&
      !String(this.facetSecondaryValue).startsWith(LIELLA_SPECIAL_PREFIX);

    wrap.classList.toggle("hidden", !liellaActive);
    if (!liellaActive) return;

    listEl.replaceChildren();

    for (const castName of catalog.liellaDiaryCasts || []) {
      const fullValue = `${LIELLA_PREFIX}:${castName}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "corner-pick-item";
      if (this.facetSecondaryValue === fullValue) {
        btn.classList.add("is-selected");
      }
      btn.dataset.liellaCast = castName;
      btn.textContent = castName;
      btn.addEventListener("click", () => {
        this.facetSecondaryValue =
          this.facetSecondaryValue === fullValue ? LIELLA_PREFIX : fullValue;
        this.render();
      });
      listEl.appendChild(btn);
    }
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
      <div class="filter-group-header">
        <span class="filter-group-label">メンバー</span>
      </div>
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
    this._updateDiscoveryVisibility();
    this._updateFacetAccessoryVisibility();
    this._renderCornerPickList();
    this._renderAnimePickList();

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
      facetPrimary: this.facetPrimaryKey,
      facetSecondaryValue: this.facetSecondaryValue,
      songPartialQuery: this.songPartialQuery
    };

    const { episodes: narrowedEpisodes, hitLabelsByVideoId } = applyFacetDiscoveryFilter(
      filteredEpisodes,
      extOpts
    );

    const sortedEpisodes = sortEpisodes(narrowedEpisodes, sortOrder);
    const ranking = buildRanking(narrowedEpisodes, keyword, this.quickFilterKeyword, PRIORITY_CAST_FILTERS);

    // フィルター変更時はページを1に戻す
    const filterKey = JSON.stringify({ keyword, andNames: this.andFilterNames, unitKey: this.activeUnitFilterKey, fav: this.isFavoritesFilterActive, watched: this.watchedFilterMode, other: this.isOtherVideoFilterActive, facet: this.facetPrimaryKey, secondary: this.facetSecondaryValue, song: this.songPartialQuery, sort: sortOrder });
    if (filterKey !== this._lastFilterKey) {
      this.currentPage = 1;
      this._lastFilterKey = filterKey;
    }

    const PAGE_SIZE = 50;
    const totalCount = sortedEpisodes.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    const pageStart = (this.currentPage - 1) * PAGE_SIZE;
    const pageEpisodes = sortedEpisodes.slice(pageStart, pageStart + PAGE_SIZE);

    // View に描画を委譲
    renderEpisodeList(
      this.episodeList,
      pageEpisodes,
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
    this._renderResultCount(totalCount, hasFilter, pageStart + 1, Math.min(pageStart + PAGE_SIZE, totalCount));
    this._updatePagination(totalCount, totalPages);
    this._updateActiveQuickFilter();
    this._updateActiveUnitFilter();
    this._updateResetButtonVisibility();
    this._updateCastSelectionNotice();
    this._updateEpisodeResultsVisibility();
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

  _renderResultCount(total, hasFilter, from, to) {
    const label = hasFilter ? "検索結果" : "動画一覧";
    if (total > 50) {
      this.resultCount.textContent = `${label}: ${total}件中 ${from}〜${to}件を表示`;
    } else {
      this.resultCount.textContent = `${label}: ${total}件`;
    }
  }

  _updatePagination(total, totalPages) {
    if (!this.paginationBar) return;
    const show = totalPages > 1;
    this.paginationBar.classList.toggle("hidden", !show);
    if (!show) return;
    if (this.pageIndicator) {
      this.pageIndicator.textContent = `${this.currentPage} / ${totalPages}ページ`;
    }
    if (this.pagePrevButton) this.pagePrevButton.disabled = this.currentPage <= 1;
    if (this.pageNextButton) this.pageNextButton.disabled = this.currentPage >= totalPages;
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
    return isFacetDiscoveryActive({
      facetPrimary: this.facetPrimaryKey,
      facetSecondaryValue: this.facetSecondaryValue,
      songPartialQuery: this.songPartialQuery
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
    const hasSongQuery = Boolean(this.songPartialQuery.trim());
    const hasSecondary = Boolean(this.facetSecondaryValue.trim());
    const shouldShow =
      this.andFilterNames.length > 0 ||
      Boolean(this.quickFilterKeyword) ||
      Boolean(this.activeUnitFilterKey) ||
      Boolean(this.facetPrimaryKey) ||
      hasSecondary ||
      hasSongQuery;

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

  _resetDiscoveryFilters() {
    this.facetPrimaryKey     = FACET_PRIMARY_NONE;
    this.facetSecondaryValue = "";
    this.songPartialQuery    = "";
    if (this.facetPrimarySelect) {
      this.facetPrimarySelect.value = FACET_PRIMARY_NONE;
    }
    this._populateFacetSecondaryOptions();
    if (this.facetSecondarySelect) {
      this.facetSecondarySelect.value = "";
    }
    if (this.songPartialInput) {
      this.songPartialInput.value = "";
    }
    this.render();
  }

  _resetFilters() {
    this.andFilterNames        = [];
    this.quickFilterKeyword    = "";
    this.activeUnitFilterKey   = "";
    this.isFavoritesFilterActive  = false;
    this.watchedFilterMode     = "";
    this.isOtherVideoFilterActive = false;

    this.facetPrimaryKey       = FACET_PRIMARY_NONE;
    this.facetSecondaryValue   = "";
    this.songPartialQuery      = "";
    this.isDiscoveryVisible    = false;
    if (this.facetPrimarySelect) {
      this.facetPrimarySelect.value = FACET_PRIMARY_NONE;
    }
    this._populateFacetSecondaryOptions();
    if (this.facetSecondarySelect) {
      this.facetSecondarySelect.value = "";
    }
    if (this.songPartialInput) {
      this.songPartialInput.value = "";
    }

    this.render();
  }
}
