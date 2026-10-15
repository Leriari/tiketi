// Work Order 05 B4 — the Scanner PWA's service worker. App-shell caching
// only, so the surface is installable and *launches* with no
// connectivity. It must never intercept anything in or near the
// validation path, which the project's central claim depends on making
// zero network calls at all (see docs/offline-validation.md and
// src/scanner/validate.js's own header comment) — there's nothing for a
// service worker to even help with there, only something it could break
// by getting in the way.
//
// Registered only from ScannerShell.jsx, not app-wide — see that file for
// why.
const CACHE_NAME = "tiketi-scanner-shell-v1";
const APP_SHELL_PATHS = ["/", "/scanner", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_PATHS))
      .catch(() => {}) // a precache miss must never block install
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch the backend: every real API call (sync, scan-upload,
  // auth, everything under /api/v1, and anything cross-origin) passes
  // through completely untouched, as if this service worker didn't
  // exist. This is the one rule that matters most in this file.
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) {
    return;
  }

  // Only cache GETs for the app shell itself (HTML/JS/CSS/icons) — a
  // stale-while-revalidate so a repeat launch is instant, falling back to
  // cache only when the network genuinely isn't there.
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
