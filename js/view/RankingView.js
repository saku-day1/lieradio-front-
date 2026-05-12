/**
 * View: RankingView
 * ランキングセクションの描画を担当する。
 * データの取得・状態管理には一切関与しない。
 */

/**
 * ランキングセクション全体を描画する。
 *
 * @param {object}   elements               DOM要素のまとまり
 * @param {Element}  elements.rankingSection ランキングセクション要素
 * @param {Element}  elements.rankingList    ランキングリスト <ol>
 * @param {Element}  elements.rankingTitle   ランキングタイトル <h2>
 * @param {Element}  elements.toggleButton   開閉ボタン
 * @param {object[]} ranking                ランキング配列 [{name, count}]
 * @param {string}   keyword                現在のキーワード
 * @param {boolean}  hideRanking            非表示にするか
 * @param {boolean}  isRankingVisible       現在展開中か
 */
export function renderRankingSection(elements, ranking, keyword, hideRanking, isRankingVisible) {
  const { rankingSection, rankingList, rankingTitle, toggleButton } = elements;

  if (hideRanking) {
    rankingSection.classList.add("hidden");
    return;
  }

  rankingSection.classList.remove("hidden");
  renderRankingList(rankingList, ranking);
  renderRankingTitle(rankingTitle, keyword);
  rankingList.classList.toggle("hidden", !isRankingVisible);
  toggleButton.textContent = isRankingVisible ? "閉じる" : "表示する";
}

function renderRankingList(rankingListEl, ranking) {
  if (ranking.length === 0) {
    rankingListEl.innerHTML = "<li>該当データなし</li>";
    return;
  }

  rankingListEl.innerHTML = ranking
    .map((item) => `<li>${item.name}（${item.count}回）</li>`)
    .join("");
}

function renderRankingTitle(rankingTitleEl, keyword) {
  rankingTitleEl.textContent = keyword
    ? `${keyword}の共演者ランキング`
    : "出演回数ランキング";
}

/**
 * リクエスト曲ランキングセクションを描画する。
 * 曲検索時のみ表示し、曲名クリックで onSongClick(songName) を呼ぶ。
 *
 * @param {object}   elements
 * @param {Element}  elements.section
 * @param {Element}  elements.list
 * @param {Element}  elements.toggleButton
 * @param {object[]} songRanking [{name, count}]
 * @param {boolean}  isVisible
 * @param {boolean}  show
 * @param {function} onSongClick
 */
export function renderSongRankingSection(elements, songRanking, isVisible, show, onSongClick) {
  const { section, list, toggleButton } = elements;

  if (!show) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  list.classList.toggle("hidden", !isVisible);
  toggleButton.textContent = isVisible ? "閉じる" : "表示する";

  if (!isVisible) return;

  if (songRanking.length === 0) {
    list.innerHTML = "<li>該当データなし</li>";
    return;
  }

  list.replaceChildren();
  for (const item of songRanking) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "song-ranking-item";
    btn.textContent = `${item.name}（${item.count}回）`;
    btn.addEventListener("click", () => onSongClick(item.name));
    li.appendChild(btn);
    list.appendChild(li);
  }
}
