import episodesHandler from "./episodes.js";

export default async function handler(request, response) {
  request.query = {
    ...(request.query || {}),
    refresh: "1"
  };

  if (typeof request.url === "string" && !request.url.includes("refresh=1")) {
    const separator = request.url.includes("?") ? "&" : "?";
    request.url = `${request.url}${separator}refresh=1`;
  }

  return episodesHandler(request, response);
}
