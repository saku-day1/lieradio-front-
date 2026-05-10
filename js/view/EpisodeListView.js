/**
 * View: EpisodeListView
 * エピソード一覧の描画を担当する。
 * データの取得・状態管理には一切関与しない。
 *
 * 外部からDOMエレメントとデータを受け取り、HTMLを生成して描画する。
 * イベント（お気に入り・視聴済み）はコールバックで Controller に委譲する。
 */

import {
  getAllCastMembers,
  extractYoutubeVideoId,
  isCompilationTitle,
  isPublicRecordingTitle,
  isOtherVideoTitle
} from "../model/EpisodeRepository.js";
import { UNIT_FILTERS, CAST_COLOR_MAP } from "../constants.js";

/**
 * エピソード一覧を描画する。
 *
 * @param {HTMLElement} episodeListEl  描画先の <ul> 要素
 * @param {object[]}    episodes       表示するエピソード配列
 * @param {boolean}     isAndMode      AND検索モードか否か
 * @param {Set}         favorites      お気に入り videoId セット
 * @param {Set}         watched        視聴済み videoId セット
 * @param {Function}    onFavToggle    お気に入りボタン押下時のコールバック (videoId) => void
 * @param {Function}    onWatchedToggle 視聴済みボタン押下時のコールバック (videoId) => void
 */
export function renderEpisodeList(
  episodeListEl,
  episodes,
  isAndMode = false,
  favorites = new Set(),
  watched = new Set(),
  onFavToggle = () => {},
  onWatchedToggle = () => {}
) {
  if (episodes.length === 0) {
    episodeListEl.innerHTML = "<li class='empty-message'>該当する放送回がありません。</li>";
    return;
  }

  episodeListEl.innerHTML = episodes
    .map((episode) => buildEpisodeItemHtml(episode, isAndMode, favorites, watched))
    .join("");

  episodeListEl.querySelectorAll(".fav-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const videoId = btn.dataset.videoId;
      if (videoId) onFavToggle(videoId);
    });
  });

  episodeListEl.querySelectorAll(".watched-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const videoId = btn.dataset.videoId;
      if (videoId) onWatchedToggle(videoId);
    });
  });
}

// ---------------------------------------------------------------------------
// 内部ヘルパー（このファイル内でのみ使用）
// ---------------------------------------------------------------------------

function buildEpisodeItemHtml(episode, isAndMode, favorites, watched) {
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
  const isWatched = videoId ? watched.has(videoId) : false;

  const thumbHtml = thumbUrl
    ? `
      <a class="episode-thumb" href="${safeYoutubeUrl}" target="_blank" rel="noopener noreferrer" aria-label="YouTubeで「${safeTitle}」を見る">
        <img src="${thumbUrl}" alt="" loading="lazy" decoding="async" width="320" height="180">
        <span class="episode-thumb-play" aria-hidden="true">▶</span>
      </a>
    `
    : "";

  const castBadgesHtml = isCompilationTitle(episode.title) ? "" : buildCastBadgesHtml(castMembers);
  const unitBadgesHtml = isCompilationTitle(episode.title) ? "" : buildUnitBadgesHtml(castMembers);

  const favBtn = videoId
    ? `<button type="button" class="fav-button${isFav ? " is-fav" : ""}" data-video-id="${videoId}" aria-label="${isFav ? "お気に入りを解除" : "お気に入りに追加"}" aria-pressed="${isFav}">${isFav ? "♥" : "♡"}</button>`
    : "";
  const watchedBtn = videoId
    ? `<button type="button" class="watched-button${isWatched ? " is-watched" : ""}" data-video-id="${videoId}" aria-label="${isWatched ? "視聴済みを解除" : "視聴済みにする"}" aria-pressed="${isWatched}">${isWatched ? "✓" : "○"}</button>`
    : "";

  return `
    <li class="episode-item">
      <div class="episode-item-layout">
        ${thumbHtml}
        <div class="episode-content">
          <div class="episode-title-row">
            <h3>${safeTitle}</h3>
            ${watchedBtn}${favBtn}
          </div>
          <div class="cast-badges" aria-label="出演者">${castBadgesHtml}</div>
          ${unitBadgesHtml ? `<div class="unit-badges" aria-label="ユニット">${unitBadgesHtml}</div>` : ""}
          <p class="meta">公開日: ${safePublishedAt}</p>
          <a href="${safeYoutubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a>
        </div>
      </div>
    </li>
  `;
}

function buildCastBadgesHtml(castMembers) {
  if (!Array.isArray(castMembers) || castMembers.length === 0) {
    return `<span class="cast-fallback">出演者情報未設定</span>`;
  }
  if (castMembers.length === 1 && castMembers[0] === "出演者情報未設定") {
    return `<span class="cast-fallback">出演者情報未設定</span>`;
  }

  return castMembers
    .map((name) => {
      const safeName = escapeHtml(name);
      const color = CAST_COLOR_MAP[name] || null;
      if (color) {
        const safeColor = String(color).replace(/"/g, "");
        return `<span class="cast-badge" style="--cast-color: ${safeColor};">${safeName}</span>`;
      }
      return `<span class="cast-badge cast-badge--others">${safeName}</span>`;
    })
    .join("");
}

function buildUnitBadgesHtml(castMembers) {
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

  if (isPublicRecordingTitle(title) || isOtherVideoTitle(title)) {
    return title;
  }

  const hasEpisodeLabel = /(第\s*\d+\s*回|#\s*\d+)/i.test(title);
  if (hasEpisodeLabel) {
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

function getThumbnailUrl(videoId) {
  if (!videoId) return "";
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
