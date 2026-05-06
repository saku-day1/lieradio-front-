"use strict";

// 取得した全エピソードデータを保持する
let allEpisodes = [];

// DOMをまとめて取得しておく（毎回querySelectorしないため）
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const rankingList = document.getElementById("rankingList");
const episodeList = document.getElementById("episodeList");
const resultCount = document.getElementById("resultCount");

// ページ初期化
init();

async function init() {
  try {
    allEpisodes = await fetchEpisodes();
    bindEvents();
    render();
  } catch (error) {
    // 失敗したときに最低限のエラーメッセージを表示
    episodeList.innerHTML = "<p class='empty-message'>データの読み込みに失敗しました。</p>";
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
}

// 画面の再描画を1つの関数にまとめる
function render() {
  const keyword = searchInput.value.trim();
  const sortOrder = sortSelect.value;

  const filteredEpisodes = filterEpisodes(allEpisodes, keyword);
  const sortedEpisodes = sortEpisodes(filteredEpisodes, sortOrder);
  const ranking = buildRanking(filteredEpisodes);

  renderEpisodeList(sortedEpisodes);
  renderRanking(ranking);
  renderResultCount(sortedEpisodes.length);
}

// ゲスト名の部分一致検索（大文字/小文字の差をなくす）
function filterEpisodes(episodes, keyword) {
  if (!keyword) {
    return episodes;
  }

  const lowerKeyword = keyword.toLowerCase();
  return episodes.filter((episode) =>
    episode.castMembers.some((member) =>
      member.toLowerCase().includes(lowerKeyword)
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
    episodeList.innerHTML = "<p class='empty-message'>該当する放送回がありません。</p>";
    return;
  }

  episodeList.innerHTML = episodes
    .map((episode) => {
      const guests = episode.castMembers.join(" / ");
      return `
        <article class="episode-item">
          <h3>第${episode.episodeNumber}回 ${episode.title}</h3>
          <p class="meta">ゲスト: ${guests}</p>
          <p class="meta">公開日: ${episode.publishedAt}</p>
          <a href="${episode.youtubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a>
        </article>
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
