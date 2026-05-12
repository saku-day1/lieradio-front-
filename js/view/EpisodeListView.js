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

const META_TYPE_LABELS = {
  corner: "コーナー",
  lunchSong: "リクエスト曲",
  birthday: "誕生日祝い",
  incident: "出来事",
  externalShow: "外部番組・メディア",
  eventName: "イベント",
  animeSeasonTag: "アニメ期タグ",
  netaTag: "タグ",
  liveImpression: "ライブ感想",
  eventImpression: "イベント感想",
  animeImpression: "アニメ感想",
  publicRecordingNote: "公開録音",
  miscTag: "備考タグ",
  remark: "備考",
  generic: "メタ情報"
};

/**
 * Excel 由来タグ一覧をユーザー向けの詳細リストに変換する。
 */
function metaDetailsHtml(manualMeta) {
  if (!manualMeta || !Array.isArray(manualMeta.tags) || manualMeta.tags.length === 0) {
    return "";
  }

  const rows = [...manualMeta.tags].sort(
    (a, b) =>
      Number(b.priority || 0) - Number(a.priority || 0) ||
      String(META_TYPE_LABELS[a.type] || a.type).localeCompare(String(META_TYPE_LABELS[b.type] || b.type), "ja") ||
      a.name.localeCompare(b.name, "ja")
  );

  const body = rows
    .map((tag) => {
      const category = META_TYPE_LABELS[tag.type] || tag.type || "情報";
      return `<li>
        <div class="meta-tag-row-main">
          <span class="meta-tag-type">${escapeHtml(category)}</span>
          <span class="meta-tag-value">${escapeHtml(tag.name)}</span>
        </div>
      </li>`;
    })
    .join("");

  return `
    <details class="episode-meta-details">
      <summary>詳細</summary>
      <ol class="meta-tag-detail-list">${body}</ol>
    </details>
  `;
}

/**
 * エピソード一覧を描画する。
 */
export function renderEpisodeList(
  episodeListEl,
  episodes,
  isAndMode = false,
  favorites = new Set(),
  watched = new Set(),
  onFavToggle = () => {},
  onWatchedToggle = () => {},
  hitLabelsByVideoId = null,
  memos = new Map(),
  onMemoSave = () => {}
) {
  const hitMap = hitLabelsByVideoId instanceof Map ? hitLabelsByVideoId : new Map();

  if (episodes.length === 0) {
    episodeListEl.innerHTML = "<li class='empty-message'>該当する放送回がありません。</li>";
    return;
  }

  episodeListEl.innerHTML = episodes
    .map((episode) => buildEpisodeItemHtml(episode, isAndMode, favorites, watched, hitMap, memos))
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

  episodeListEl.querySelectorAll(".memo-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const videoId = btn.dataset.videoId;
      const editWrap = episodeListEl.querySelector(`.memo-edit-wrap[data-video-id="${videoId}"]`);
      if (!editWrap) return;
      const isOpen = !editWrap.classList.contains("hidden");
      editWrap.classList.toggle("hidden", isOpen);
      if (!isOpen) editWrap.querySelector(".memo-textarea")?.focus();
    });
  });

  episodeListEl.querySelectorAll(".memo-textarea").forEach((textarea) => {
    const videoId = textarea.closest(".memo-edit-wrap")?.dataset.videoId;
    if (!videoId) return;
    textarea.addEventListener("blur", () => {
      onMemoSave(videoId, textarea.value);
      const hasMemo = Boolean(textarea.value.trim());
      const preview = episodeListEl.querySelector(`.memo-preview[data-video-id="${videoId}"]`);
      const btn = episodeListEl.querySelector(`.memo-button[data-video-id="${videoId}"]`);
      if (preview) {
        preview.textContent = textarea.value.trim();
        preview.classList.toggle("hidden", !hasMemo);
      }
      if (btn) {
        btn.classList.toggle("is-active", hasMemo);
        btn.setAttribute("aria-pressed", String(hasMemo));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 内部ヘルパー（このファイル内でのみ使用）
// ---------------------------------------------------------------------------

/**
 * @param {Map<string, string[]>} hitMap
 */
function buildEpisodeItemHtml(episode, isAndMode, favorites, watched, hitMap, memos = new Map()) {
  const castMembers = getAllCastMembers(episode);
  const displayedNumber = episode.broadcastNumber ?? episode.episodeNumber;
  const titleText = isAndMode ? episode.title : formatEpisodeHeading(displayedNumber, episode.title);

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

  const memoText = videoId ? (memos.get(videoId) || "") : "";
  const hasMemo = Boolean(memoText);
  const memoBtn = videoId
    ? `<button type="button" class="memo-button${hasMemo ? " is-active" : ""}" data-video-id="${videoId}" aria-label="メモ" aria-pressed="${hasMemo}">📝</button>`
    : "";
  const memoPreviewHtml = videoId
    ? `<p class="memo-preview${hasMemo ? "" : " hidden"}" data-video-id="${videoId}">${escapeHtml(memoText)}</p>`
    : "";
  const memoEditHtml = videoId
    ? `<div class="memo-edit-wrap hidden" data-video-id="${videoId}"><textarea class="memo-textarea" rows="3" placeholder="メモを入力…">${escapeHtml(memoText)}</textarea></div>`
    : "";

  const manualMeta = episode.manualMeta;
  const hitLines =
    videoId && hitMap?.has(videoId)
      ? (hitMap.get(videoId) || [])
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")
      : "";
  const hitBlock = hitLines
    ? `<ul class="episode-hit-lines" aria-label="検索ヒット詳細">${hitLines}</ul>`
    : "";

  const cornersLineHtml = manualMeta?.corners?.length
    ? `<p class="meta-line episode-line-corners"><span class="meta-k">コーナー</span><span class="meta-v">${manualMeta.corners
        .map((x) => escapeHtml(x))
        .join(" / ")}</span></p>`
    : "";

  const lunchLineHtml = manualMeta?.lunchTimeRequestSong
    ? `<p class="meta-line episode-line-lunch"><span class="meta-k">リクエスト曲</span><span class="meta-v">${escapeHtml(manualMeta.lunchTimeRequestSong)}</span></p>`
    : "";

  const primaryTags = manualMeta?.primaryTagsForList || [];
  const primaryHtml = primaryTags.length
    ? `<div class="primary-tag-row" aria-label="主要タグ">${primaryTags
        .map(
          (t) =>
            `<span class="primary-tag-chip" title="${escapeHtml(META_TYPE_LABELS[t.type] || t.type)}">${escapeHtml(
              t.name
            )}</span>`
        )
        .join("")}</div>`
    : "";

  const detailsHtml = metaDetailsHtml(manualMeta);

  return `
    <li class="episode-item">
      <div class="episode-item-layout">
        ${thumbHtml}
        <div class="episode-content">
          <div class="episode-title-row">
            <h3>${safeTitle}</h3>
            ${watchedBtn}${favBtn}${memoBtn}
          </div>
          <div class="cast-badges" aria-label="出演者">${castBadgesHtml}</div>
          ${unitBadgesHtml ? `<div class="unit-badges" aria-label="ユニット">${unitBadgesHtml}</div>` : ""}
          ${cornersLineHtml}
          ${lunchLineHtml}
          ${primaryHtml}
          ${hitBlock}
          ${memoPreviewHtml}
          ${memoEditHtml}
          <p class="meta">公開日: ${safePublishedAt}</p>
          ${detailsHtml}
          <a href="${safeYoutubeUrl}" target="_blank" rel="noopener noreferrer">YouTubeで見る</a>
        </div>
      </div>
    </li>
  `;
}

function buildCastBadgesHtml(castMembers) {
  if (!Array.isArray(castMembers) || castMembers.length === 0) {
    return "";
  }
  if (castMembers.length === 1 && castMembers[0] === "出演者情報未設定") {
    return "";
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
