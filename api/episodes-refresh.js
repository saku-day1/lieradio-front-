import episodesHandler from "./episodes.js";
import { invalidateCache as invalidateMetaCache } from "./episode-meta.js";

export default async function handler(request, response) {
  request.query = {
    ...(request.query || {}),
    refresh: "1"
  };

  if (typeof request.url === "string" && !request.url.includes("refresh=1")) {
    const separator = request.url.includes("?") ? "&" : "?";
    request.url = `${request.url}${separator}refresh=1`;
  }

  // エピソードキャッシュ更新と同時にメタキャッシュも破棄する
  await invalidateMetaCache().catch((err) => {
    console.error("[episodes-refresh] meta cache invalidation failed:", err);
  });

  return episodesHandler(request, response);
}
