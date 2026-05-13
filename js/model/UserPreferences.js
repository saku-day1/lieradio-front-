/**
 * Model: UserPreferences
 * お気に入り・視聴済みの状態を localStorage で管理する。
 * UI や エピソードデータには一切依存しない。
 */

const FAVORITES_KEY = "lieradio_favorites";
const WATCHED_KEY = "lieradio_watched";
const MEMOS_KEY = "lieradio_memos";

export function loadFavorites() {
  try {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch {
    return new Set();
  }
}

export function loadWatched() {
  try {
    const data = localStorage.getItem(WATCHED_KEY);
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch {
    return new Set();
  }
}

export function toggleFavorite(videoId) {
  const favorites = loadFavorites();
  if (favorites.has(videoId)) {
    favorites.delete(videoId);
  } else {
    favorites.add(videoId);
  }
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    // localStorage が使えない環境では無視
  }
}

export function toggleWatched(videoId) {
  const watched = loadWatched();
  if (watched.has(videoId)) {
    watched.delete(videoId);
  } else {
    watched.add(videoId);
  }
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...watched]));
  } catch {
    // localStorage が使えない環境では無視
  }
}

export function loadMemos() {
  try {
    const data = localStorage.getItem(MEMOS_KEY);
    return data ? new Map(Object.entries(JSON.parse(data))) : new Map();
  } catch {
    return new Map();
  }
}

export function saveMemo(videoId, text) {
  const memos = loadMemos();
  const trimmed = text.trim();
  if (trimmed) {
    memos.set(videoId, trimmed);
  } else {
    memos.delete(videoId);
  }
  try {
    localStorage.setItem(MEMOS_KEY, JSON.stringify(Object.fromEntries(memos)));
  } catch {}
}

export function buildExportPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: [...loadFavorites()],
    watched: [...loadWatched()],
    memos: Object.fromEntries(loadMemos())
  };
}

export function importUserData(payload) {
  if (!payload || payload.version !== 1) {
    throw new Error("Invalid backup format");
  }
  try {
    if (Array.isArray(payload.favorites)) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(payload.favorites));
    }
    if (Array.isArray(payload.watched)) {
      localStorage.setItem(WATCHED_KEY, JSON.stringify(payload.watched));
    }
    if (payload.memos && typeof payload.memos === "object" && !Array.isArray(payload.memos)) {
      localStorage.setItem(MEMOS_KEY, JSON.stringify(payload.memos));
    }
  } catch {
    throw new Error("Failed to write to localStorage");
  }
}
