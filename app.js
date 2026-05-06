"use strict";

// 取得した全エピソードデータを保持する
let allEpisodes = [];

// DOMをまとめて取得しておく（毎回querySelectorしないため）
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const rankingList = document.getElementById("rankingList");
const toggleRankingButton = document.getElementById("toggleRankingButton");
const episodeList = document.getElementById("episodeList");
const resultCount = document.getElementById("resultCount");
const urlResultBox = document.getElementById("urlResultBox");
const urlResultList = document.getElementById("urlResultList");
let isRankingVisible = false;

// ページ初期化
init();

async function init() {
  try {
    allEpisodes = await fetchEpisodes();
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
  searchInput.addEventListener("input", render);
  sortSelect.addEventListener("change", render);
  toggleRankingButton.addEventListener("click", toggleRankingVisibility);
}

// 画面の再描画を1つの関数にまとめる
function render() {
  const keyword = searchInput.value.trim();
  const sortOrder = sortSelect.value;

  const filteredEpisodes = filterEpisodes(allEpisodes, keyword);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes);

  renderEpisodeList(sortedEpisodes);
  renderUrlResultList(sortedEpisodes, keyword);
  renderRanking(ranking);
  renderResultCount(sortedEpisodes.length);
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
