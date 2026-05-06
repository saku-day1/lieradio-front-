/**
 * Vercel Serverless Function
 * YouTube APIキーをサーバー側だけで利用し、フロントへ露出させない。
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";

// タイトル/概要欄から検出するための候補（必要に応じて増やしてください）
const KNOWN_CAST_MEMBERS = [
  "伊達さゆり",
  "Liyuu",
  "岬なこ",
  "ペイトン尚未",
  "青山なぎさ",
  "鈴原希実",
  "薮島朱音",
  "大熊和奏",
  "絵森彩",
  "結那",
  "坂倉花"
];

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
  const castMembers = extractCastMembers(title, description);

  return {
    episodeNumber,
    title,
    castMembers,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt
  };
}

function extractCastMembers(title, description) {
  const text = `${title}\n${description}`;
  const detected = KNOWN_CAST_MEMBERS.filter((name) => text.includes(name));

  // 誰も検出できなかった場合、検索UIで扱いやすいように共通ラベルを付与
  return detected.length > 0 ? detected : ["ゲスト情報未設定"];
}
