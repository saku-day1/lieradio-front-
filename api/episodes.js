/**
 * Vercel Serverless Function
 * YouTube APIキーをサーバー側だけで利用し、フロントへ露出させない。
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";

// 説明欄から検出する既知メンバー（表記ゆれ吸収後の正規名）
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

// 表記ゆれを正規化する辞書
const NAME_ALIASES = {
  "伊達 さゆり": "伊達さゆり",
  "岬 なこ": "岬なこ",
  "絵森 彩": "絵森彩",
  "大熊 和奏": "大熊和奏",
  "坂倉 花": "坂倉花",
  "籔島 朱音": "薮島朱音",
  "籔島朱音": "薮島朱音",
  "鈴原希美": "鈴原希実"
};

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
  const { mainCast, guests } = extractCastFromDescription(description);
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

function extractCastFromDescription(description) {
  const lines = description.split("\n");
  const mainCast = [];
  const guests = [];
  let section = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    // 見出し検出（絵文字や記号の違いも吸収）
    if (/メイン\s*MC/i.test(line)) {
      section = "main";
      continue;
    }
    if (/ゲスト/.test(line)) {
      section = "guest";
      continue;
    }

    // 別セクションに入ったら出演者抽出モードを終了
    if (/^【.+】/.test(line) && !/出演/.test(line)) {
      section = "";
      continue;
    }

    if (!section) {
      continue;
    }

    const names = splitAndCleanNames(line);
    if (names.length === 0) {
      continue;
    }

    if (section === "main") {
      mainCast.push(...names);
    } else if (section === "guest") {
      guests.push(...names);
    }
  }

  // セクションから拾えない古い回向けに、既知メンバー全文探索も併用
  const normalizedText = normalizeForSearch(description);
  if (mainCast.length === 0 && guests.length === 0) {
    const detected = KNOWN_CAST_MEMBERS.filter((name) =>
      normalizedText.includes(normalizeForSearch(name))
    );
    return { mainCast: [], guests: detected };
  }

  return {
    mainCast: uniqueNames(mainCast),
    guests: uniqueNames(guests)
  };
}

function splitAndCleanNames(line) {
  const chunks = line
    .split(/[、\/]/)
    .map((part) => cleanName(part))
    .filter(Boolean);

  return chunks;
}

function cleanName(rawLine) {
  // 先頭の記号・絵文字・全角空白を除去
  const withoutPrefix = rawLine
    .replace(/^[・\-ー◆🎤🌟🌈\s　]+/, "")
    .replace(/^※\s*/, "");

  // "坂倉 花（鬼塚冬毬役）" -> "坂倉 花"
  const nameOnly = withoutPrefix.split("（")[0].trim();

  if (!nameOnly) {
    return "";
  }

  // 説明文ノイズ行は除外
  const noisePattern =
    /(出演見合わせ|詳細|ご確認|配信日程|お便り|関連サイト|公式|毎週|過去回|https?:\/\/|#lovelive|プロジェクト)/;
  if (noisePattern.test(nameOnly)) {
    return "";
  }

  const normalized = normalizeDisplayName(nameOnly);
  return normalized;
}

function uniqueNames(names) {
  return [...new Set(names)];
}

function normalizeDisplayName(name) {
  const compact = name.replace(/\s+/g, "");
  return NAME_ALIASES[name] || NAME_ALIASES[compact] || compact;
}

function normalizeForSearch(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}
