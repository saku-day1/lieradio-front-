/**
 * Model: UserPreferences
 * お気に入り・視聴済みの状態を localStorage で管理する。
 * UI や エピソードデータには一切依存しない。
 */

const FAVORITES_KEY = "lieradio_favorites";
const WATCHED_KEY = "lieradio_watched";

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
