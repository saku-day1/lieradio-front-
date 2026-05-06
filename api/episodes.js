/**
 * Vercel Serverless Function
 * YouTube APIキーをサーバー側だけで利用し、フロントへ露出させない。
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";

// 説明欄のセクション見出し
const MAIN_MC_MARKER = "🎤メインMC";
const GUEST_MARKER = "🌟ゲスト";

export default async function handler(request, response) {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const playlistId = process.env.YOUTUBE_PLAYLIST_ID;

    if (!apiKey || !playlistId) {
      return response.status(500).json({
        error: "Missing YOUTUBE_API_KEY or YOUTUBE_PLAYLIST_ID"
      });
    }

    const items = await fetchAllPlaylistItems(apiKey, playlistId);
    const episodes = items.map((item, index) => toEpisode(item, index + 1));

    // 公開日の古い順で回番号を振り直す（第1回が一番古い想定）
    const normalized = episodes
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
      .map((episode, index) => ({
        ...episode,
        episodeNumber: index + 1
      }));

    return response.status(200).json(normalized);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to load playlist data." });
  }
}

async function fetchAllPlaylistItems(apiKey, playlistId) {
  const allItems = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId,
      key: apiKey
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url = `${YOUTUBE_API_BASE}?${params.toString()}`;
    const result = await fetch(url);
    if (!result.ok) {
      throw new Error(`YouTube API failed: ${result.status}`);
    }

    const data = await result.json();
    allItems.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return allItems;
}

function toEpisode(item, episodeNumber) {
  const snippet = item.snippet || {};
  const title = snippet.title || "タイトル未設定";
  const description = snippet.description || "";
  const videoId = (snippet.resourceId && snippet.resourceId.videoId) || "";
  const publishedAt = (snippet.publishedAt || "").slice(0, 10);
  const mainCast = extractPeopleFromSection(description, MAIN_MC_MARKER);
  const guests = extractPeopleFromSection(description, GUEST_MARKER);
  const castMembers = uniqueNames([...mainCast, ...guests]);

  return {
    episodeNumber,
    title,
    mainCast,
    guests,
    castMembers,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt
  };
}

function extractPeopleFromSection(description, marker) {
  // マーカー位置を探す（例: "🎤メインMC", "🌟ゲスト"）
  const startIndex = description.indexOf(marker);
  if (startIndex === -1) {
    return [];
  }

  // セクション開始位置から次の見出しまでを切り出す
  const sectionStart = startIndex + marker.length;
  const remaining = description.slice(sectionStart);
  const sectionEnd = findSectionEndIndex(remaining);
  const sectionText = sectionEnd === -1 ? remaining : remaining.slice(0, sectionEnd);

  // 1行ずつ処理し、名前だけを抽出
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("※"))
    .map(cleanName)
    .filter(Boolean);
}

function findSectionEndIndex(text) {
  const candidates = [
    text.indexOf("【"),
    text.indexOf("🎤"),
    text.indexOf("🌟"),
    text.indexOf("◆"),
    text.indexOf("#")
  ].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return -1;
  }
  return Math.min(...candidates);
}

function cleanName(rawLine) {
  // 先頭の記号や全角スペースを除去
  const withoutPrefix = rawLine.replace(/^[・\-ー\s　]+/, "");

  // "坂倉 花（鬼塚冬毬役）" -> "坂倉 花"
  const nameOnly = withoutPrefix.split("（")[0].trim();

  // URL行などは除外
  if (!nameOnly || /^https?:\/\//.test(nameOnly)) {
    return "";
  }

  return nameOnly;
}

function uniqueNames(names) {
  return [...new Set(names)];
}
