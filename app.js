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
const episodeResultsCollapsible = document.getElementById("episodeResultsCollapsible");
const toggleEpisodeListButton = document.getElementById("toggleEpisodeListButton");
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
const OTHERS_FILTER_KEY = "__others__";
const UNIT_FILTERS = [
  { key: "catchu", label: "CatChu!", color: "#ef4444", members: ["伊達さゆり", "ペイトン尚未", "薮島朱音"] },
  { key: "kaleidoscore", label: "KALEIDOSCORE", color: "#3b82f6", members: ["Liyuu", "青山なぎさ", "結那"] },
  { key: "syncri5e", label: "5yncri5e!", color: "#facc15", members: ["岬なこ", "鈴原希実", "大熊和奏", "絵森彩", "坂倉花"] },
  { key: "team-kodomo", label: "チームこども", color: "#ef4444", members: ["伊達さゆり", "Liyuu", "鈴原希実", "絵森彩"] },
  { key: "team-sports", label: "チームスポーツ", color: "#3b82f6", members: ["岬なこ", "ペイトン尚未", "薮島朱音", "結那"] },
  { key: "team-midori", label: "チームみどり", color: "#22c55e", members: ["青山なぎさ", "大熊和奏", "坂倉花"] },
  { key: "yuisaku", label: "ゆいさく", color: "#ff7eb6", members: ["結那", "坂倉花"] }
];

// ページ初期化
init();

async function init() {
  try {
    allEpisodes = await fetchEpisodes();
    renderCastQuickFilters(allEpisodes);
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
}

function isAnyFilterActive() {
  return (
    andFilterNames.length > 0 ||
    quickFilterKeyword === OTHERS_FILTER_KEY ||
    Boolean(activeUnitFilterKey)
  );
}

function renderCastQuickFilters(episodes) {
  const existingCastNames = new Set(
    episodes.flatMap((episode) => getAllCastMembers(episode))
  );
  existingCastNames.delete("出演者情報未設定");

  const priorityNames = new Set(PRIORITY_CAST_FILTERS.map((item) => item.name));
  const hasOthers = [...existingCastNames].some((name) => !priorityNames.has(name));

  const castButtons = PRIORITY_CAST_FILTERS.map((item) => `
    <button
      type="button"
      class="cast-filter-button"
      data-filter-key="${item.name}"
      style="--cast-color: ${item.color};"
    >
      ${item.name}
    </button>
  `);

  if (hasOthers) {
    castButtons.push(`
      <button type="button" class="cast-filter-button cast-filter-button-others" data-filter-key="${OTHERS_FILTER_KEY}">
        その他
      </button>
    `);
  }

  castQuickFilters.innerHTML = castButtons.join("");

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

  if (filterKey === OTHERS_FILTER_KEY) {
    if (quickFilterKeyword === OTHERS_FILTER_KEY) {
      quickFilterKeyword = "";
      return;
    }
    andFilterNames = [];
    quickFilterKeyword = OTHERS_FILTER_KEY;
    activeUnitFilterKey = "";
    return;
  }

  if (quickFilterKeyword === OTHERS_FILTER_KEY) {
    quickFilterKeyword = "";
  }
  activeUnitFilterKey = "";

  const existingIndex = andFilterNames.indexOf(filterKey);
  if (existingIndex >= 0) {
    andFilterNames.splice(existingIndex, 1);
  } else if (andFilterNames.length < 3) {
    andFilterNames.push(filterKey);
  }

  quickFilterKeyword = andFilterNames.length === 1 ? andFilterNames[0] : "";
}

// 画面の再描画を1つの関数にまとめる
function render() {
  const hasFilter = isAnyFilterActive();
  if (lastRenderHadFilter && !hasFilter) {
    isEpisodeListVisible = false;
  }
  lastRenderHadFilter = hasFilter;

  const keyword = quickFilterKeyword;
  const isAndMode = andFilterNames.length >= 2;
  const isUnitMode = Boolean(activeUnitFilterKey);
  const hideRanking =
    isAndMode || isUnitMode || keyword === OTHERS_FILTER_KEY;
  const sortOrder = sortSelect.value;

  const filteredEpisodes = filterEpisodes(allEpisodes, keyword, andFilterNames, activeUnitFilterKey);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes, keyword);

  renderEpisodeList(sortedEpisodes, isAndMode);
  renderRankingSection(ranking, keyword, hideRanking);
  renderResultTitle(isAndMode, hasFilter);
  renderResultCount(sortedEpisodes.length, hasFilter);
  updateActiveQuickFilter();
  updateActiveUnitFilter();
  updateResetButtonVisibility();
  updateEpisodeResultsVisibility(hasFilter);
}

// 出演者（メインMC + ゲスト）の部分一致検索
// APIデータに castMembers が無い場合は mainCast + guests を結合して扱う
function filterEpisodes(episodes, keyword, andNames = [], unitKey = "") {
  const normalizedEpisodes = episodes.map((episode) => ({
    ...episode,
    castMembers: getAllCastMembers(episode)
  }));

  if (unitKey) {
    const unit = UNIT_FILTERS.find((item) => item.key === unitKey);
    if (!unit) {
      return normalizedEpisodes;
    }
    return normalizedEpisodes.filter((episode) =>
      unit.members.every((member) => episode.castMembers.includes(member))
    );
  }

  if (andNames.length >= 2) {
    return normalizedEpisodes.filter((episode) =>
      andNames.every((name) => episode.castMembers.includes(name))
    );
  }

  if (!keyword) {
    return normalizedEpisodes;
  }

  if (keyword === OTHERS_FILTER_KEY) {
    const priorityNames = new Set(PRIORITY_CAST_FILTERS.map((item) => item.name));
    return normalizedEpisodes.filter((episode) =>
      episode.castMembers.some((member) => !priorityNames.has(member))
    );
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  return normalizedEpisodes.filter((episode) =>
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
  if (!keyword || keyword === OTHERS_FILTER_KEY) {
    return new Set();
  }

  if (quickFilterKeyword && quickFilterKeyword !== OTHERS_FILTER_KEY) {
    return new Set([quickFilterKeyword]);
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  const matched = PRIORITY_CAST_FILTERS
    .map((item) => item.name)
    .filter((name) => normalizeSearchText(name) === normalizedKeyword);

  return new Set(matched);
}

function renderEpisodeList(episodes, isAndMode = false) {
  if (episodes.length === 0) {
    episodeList.innerHTML = "<li class='empty-message'>該当する放送回がありません。</li>";
    return;
  }

  episodeList.innerHTML = episodes
    .map((episode) => {
      const allCast = getAllCastMembers(episode).join(" / ");
      const displayedNumber = episode.broadcastNumber ?? episode.episodeNumber;
      const titleText = isAndMode
        ? episode.title
        : formatEpisodeHeading(displayedNumber, episode.title);
      return `
        <li class="episode-item">
          <h3>${titleText}</h3>
          <p class="meta">出演者: ${allCast}</p>
          <p class="meta">公開日: ${episode.publishedAt}</p>
          <a href="${episode.youtubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a>
        </li>
      `;
    })
    .join("");
}

function formatEpisodeHeading(displayedNumber, rawTitle) {
  const title = String(rawTitle || "").trim();
  if (!title) {
    return `第${displayedNumber}回`;
  }

  // 公開録音はタイトル先頭の「第◯回」を外して表示する。
  if (/公開録音|公録/.test(title)) {
    return title.replace(/^第\s*\d+\s*回\s*/, "").trim();
  }

  // タイトル側に既に回番号が含まれる場合は重複表示を避ける。
  if (/^(第\s*\d+\s*回|#\s*\d+)/i.test(title)) {
    return title;
  }

  return `第${displayedNumber}回 ${title}`;
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
  if (!keyword || keyword === OTHERS_FILTER_KEY) {
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
}

function renderResultTitle(isAndMode, hasFilter) {
  if (!hasFilter) {
    resultTitle.textContent = "動画一覧";
    return;
  }
  if (isAndMode) {
    resultTitle.textContent = "検索に指定した出演者をすべて含む放送回（最大3人）";
    return;
  }
  if (quickFilterKeyword === OTHERS_FILTER_KEY) {
    resultTitle.textContent = "その他の出演者を含む回";
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
  rankingList.classList.toggle("hidden", !isRankingVisible);
  toggleRankingButton.textContent = isRankingVisible ? "閉じる" : "表示する";
}

function toggleEpisodeListVisibility() {
  isEpisodeListVisible = !isEpisodeListVisible;
  render();
}

function updateEpisodeResultsVisibility(hasFilter) {
  if (!episodeResultsCollapsible || !toggleEpisodeListButton) {
    return;
  }
  if (hasFilter) {
    episodeResultsCollapsible.classList.remove("hidden");
    toggleEpisodeListButton.classList.add("hidden");
    return;
  }
  toggleEpisodeListButton.classList.remove("hidden");
  episodeResultsCollapsible.classList.toggle("hidden", !isEpisodeListVisible);
  toggleEpisodeListButton.textContent = isEpisodeListVisible ? "閉じる" : "表示する";
}

function updateActiveQuickFilter() {
  castQuickFilters.querySelectorAll(".cast-filter-button").forEach((button) => {
    const key = button.dataset.filterKey;
    const isActive = key === OTHERS_FILTER_KEY
      ? quickFilterKeyword === OTHERS_FILTER_KEY
      : andFilterNames.includes(key || "");
    button.classList.toggle("is-active", isActive);
  });
}

function updateActiveUnitFilter() {
  unitQuickFilters.querySelectorAll(".unit-filter-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.unitKey === activeUnitFilterKey);
  });
}

function updateResetButtonVisibility() {
  const shouldShow =
    andFilterNames.length > 0 ||
    quickFilterKeyword === OTHERS_FILTER_KEY ||
    Boolean(activeUnitFilterKey);
  resetFiltersButton.classList.toggle("hidden", !shouldShow);
}

function resetFilters() {
  andFilterNames = [];
  quickFilterKeyword = "";
  activeUnitFilterKey = "";
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
