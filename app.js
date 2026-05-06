"use strict";

// 取得した全エピソードデータを保持する
let allEpisodes = [];

// DOMをまとめて取得しておく（毎回querySelectorしないため）
const searchInput = document.getElementById("searchInput");
const castQuickFilters = document.getElementById("castQuickFilters");
const resetFiltersButton = document.getElementById("resetFiltersButton");
const sortSelect = document.getElementById("sortSelect");
const rankingSection = document.getElementById("rankingSection");
const rankingTitle = document.getElementById("rankingTitle");
const rankingList = document.getElementById("rankingList");
const toggleRankingButton = document.getElementById("toggleRankingButton");
const resultTitle = document.getElementById("resultTitle");
const episodeList = document.getElementById("episodeList");
const resultCount = document.getElementById("resultCount");
const urlResultBox = document.getElementById("urlResultBox");
const urlResultList = document.getElementById("urlResultList");
let isRankingVisible = false;
let quickFilterKeyword = "";
let andFilterNames = [];

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

// ページ初期化
init();

async function init() {
  try {
    allEpisodes = await fetchEpisodes();
    renderCastQuickFilters(allEpisodes);
    bindEvents();
    render();
  } catch (error) {
    // 失敗したときに最低限のエラーメッセージを表示
    episodeList.innerHTML = "<li class='empty-message'>データの読み込みに失敗しました。</li>";
    resultCount.textContent = "";
    rankingList.innerHTML = "<li>ランキングを表示できませんでした</li>";
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
  searchInput.addEventListener("input", () => {
    quickFilterKeyword = "";
    andFilterNames = [];
    render();
  });
  sortSelect.addEventListener("change", render);
  toggleRankingButton.addEventListener("click", toggleRankingVisibility);
  resetFiltersButton.addEventListener("click", resetFilters);
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
      searchInput.value = "";
      render();
    });
  });
}

function handleQuickFilterClick(filterKey) {
  if (!filterKey) {
    return;
  }

  if (filterKey === OTHERS_FILTER_KEY) {
    andFilterNames = [];
    quickFilterKeyword = OTHERS_FILTER_KEY;
    return;
  }

  if (quickFilterKeyword === OTHERS_FILTER_KEY) {
    quickFilterKeyword = "";
  }

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
  const keyword = quickFilterKeyword || searchInput.value.trim();
  const isAndMode = andFilterNames.length >= 2;
  const sortOrder = sortSelect.value;

  const filteredEpisodes = filterEpisodes(allEpisodes, keyword, andFilterNames);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes, keyword);

  renderEpisodeList(sortedEpisodes, isAndMode);
  renderUrlResultList(sortedEpisodes, keyword);
  renderRankingSection(ranking, keyword, isAndMode);
  renderResultTitle(isAndMode);
  renderResultCount(sortedEpisodes.length);
  updateActiveQuickFilter();
  updateResetButtonVisibility();
}

// 出演者（メインMC + ゲスト）の部分一致検索
// APIデータに castMembers が無い場合は mainCast + guests を結合して扱う
function filterEpisodes(episodes, keyword, andNames = []) {
  const normalizedEpisodes = episodes.map((episode) => ({
    ...episode,
    castMembers: getAllCastMembers(episode)
  }));

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
      const titleText = isAndMode ? episode.title : `第${displayedNumber}回 ${episode.title}`;
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
  rankingTitle.textContent = keyword ? "共演数ランキング" : "出演回数ランキング";
}

function renderRankingSection(ranking, keyword, isAndMode) {
  if (isAndMode) {
    rankingSection.classList.add("hidden");
    return;
  }

  rankingSection.classList.remove("hidden");
  renderRanking(ranking);
  renderRankingTitle(keyword);
}

function renderResultTitle(isAndMode) {
  resultTitle.textContent = isAndMode ? "AND検索結果（最大3人）" : "検索結果";
}

function renderResultCount(count) {
  resultCount.textContent = `検索結果: ${count}件`;
}

function renderUrlResultList(episodes, keyword) {
  const shouldShowUrlList = keyword.length > 0;
  urlResultBox.classList.toggle("hidden", !shouldShowUrlList);

  if (!shouldShowUrlList) {
    urlResultList.innerHTML = "";
    return;
  }

  if (episodes.length === 0) {
    urlResultList.innerHTML = "<li>該当URLなし</li>";
    return;
  }

  urlResultList.innerHTML = episodes
    .map(
      (episode) =>
        `<li><a href="${episode.youtubeUrl}" target="_blank" rel="noopener noreferrer">${episode.youtubeUrl}</a></li>`
    )
    .join("");
}

function toggleRankingVisibility() {
  isRankingVisible = !isRankingVisible;
  rankingList.classList.toggle("hidden", !isRankingVisible);
  toggleRankingButton.textContent = isRankingVisible ? "閉じる" : "表示する";
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

function updateResetButtonVisibility() {
  const shouldShow = andFilterNames.length > 0 || quickFilterKeyword === OTHERS_FILTER_KEY;
  resetFiltersButton.classList.toggle("hidden", !shouldShow);
}

function resetFilters() {
  andFilterNames = [];
  quickFilterKeyword = "";
  searchInput.value = "";
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
