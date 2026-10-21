// Where an event's cover image lives, or null if it has none.
//
// The real backend returns a path ("/api/v1/events/<id>/image?v=…") served
// by the API server, which runs on a different origin from this app in
// development, so it's resolved against VITE_API_BASE_URL. The mock
// backend keeps the uploaded data: URL itself, which works as-is.
const API_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1").origin;
  } catch {
    return "";
  }
})();

export function eventImageUrl(event) {
  const url = event?.image_url || event?.image_data_url || null;
  if (!url) return null;
  return url.startsWith("/") ? `${API_ORIGIN}${url}` : url;
}
