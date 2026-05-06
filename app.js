"use strict";

// 取得した全エピソードデータを保持する
let allEpisodes = [];

// DOMをまとめて取得しておく（毎回querySelectorしないため）
const searchInput = document.getElementById("searchInput");
const castQuickFilters = document.getElementById("castQuickFilters");
const sortSelect = document.getElementById("sortSelect");
const rankingTitle = document.getElementById("rankingTitle");
const rankingList = document.getElementById("rankingList");
const toggleRankingButton = document.getElementById("toggleRankingButton");
const episodeList = document.getElementById("episodeList");
const resultCount = document.getElementById("resultCount");
const urlResultBox = document.getElementById("urlResultBox");
const urlResultList = document.getElementById("urlResultList");
let isRankingVisible = false;
let quickFilterKeyword = "";

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
    render();
  });
  sortSelect.addEventListener("change", render);
  toggleRankingButton.addEventListener("click", toggleRankingVisibility);
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
      quickFilterKeyword = button.dataset.filterKey || "";
      searchInput.value = "";
      updateActiveQuickFilter();
      render();
    });
  });
}

// 画面の再描画を1つの関数にまとめる
function render() {
  const keyword = quickFilterKeyword || searchInput.value.trim();
  const sortOrder = sortSelect.value;

  const filteredEpisodes = filterEpisodes(allEpisodes, keyword);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes);

  renderEpisodeList(sortedEpisodes);
  renderUrlResultList(sortedEpisodes, keyword);
  renderRanking(ranking);
  renderRankingTitle(keyword);
  renderResultCount(sortedEpisodes.length);
  updateActiveQuickFilter();
}

// 出演者（メインMC + ゲスト）の部分一致検索
// APIデータに castMembers が無い場合は mainCast + guests を結合して扱う
function filterEpisodes(episodes, keyword) {
  const normalizedEpisodes = episodes.map((episode) => ({
    ...episode,
    castMembers: getAllCastMembers(episode)
  }));

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
function buildRanking(episodes) {
  const countMap = episodes.reduce((acc, episode) => {
    episode.castMembers.forEach((member) => {
      acc[member] = (acc[member] || 0) + 1;
    });
    return acc;
  }, {});

  return Object.entries(countMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

function renderEpisodeList(episodes) {
  if (episodes.length === 0) {
    episodeList.innerHTML = "<li class='empty-message'>該当する放送回がありません。</li>";
    return;
  }

  episodeList.innerHTML = episodes
    .map((episode) => {
      const allCast = getAllCastMembers(episode).join(" / ");
      const displayedNumber = episode.broadcastNumber ?? episode.episodeNumber;
      return `
        <li class="episode-item">
          <h3>第${displayedNumber}回 ${episode.title}</h3>
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
    button.classList.toggle("is-active", button.dataset.filterKey === quickFilterKeyword);
  });
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
