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
const CACHE_NAME = "tiketi-scanner-shell-v2";
const APP_SHELL_PATHS = ["/", "/scanner", "/manifest.webmanifest", "/favicon.svg"];
// What a page load with no connection gets: the app's index.html (every
// route serves the same one), so /scanner/scan opens offline too.
const OFFLINE_PAGE = "/scanner";
// The page fetches its scripts with an Origin header (module scripts are
// CORS requests) and servers answer with "Vary: Origin", so a strict
// lookup misses the copies cached without one.
const MATCH = { ignoreVary: true };

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

// The page tells this worker which files it loaded (ScannerShell.jsx): the
// app's JS and CSS loaded before this worker took over, so they'd
// otherwise never be cached, and a reload with no signal would get the
// page but none of the app.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  const urls = (event.data.urls || []).filter((u) => {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin && !url.pathname.startsWith("/api/");
  });
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(urls.map((u) => cache.add(u).catch(() => {})))
    )
  );
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

  if (event.request.method !== "GET") return;

  // Page loads: the network first, so a new release is picked up at once
  // (a cached index.html would point at files a deploy has replaced); the
  // cached app only when there's no connection.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request, MATCH).then((cached) => cached || caches.match(OFFLINE_PAGE, MATCH))
        )
    );
    return;
  }

  // Everything else the app shell needs (JS/CSS/icons): stale-while-
  // revalidate, so a repeat launch is instant. Built files have hashed
  // names, so a cached copy is never out of date.

  event.respondWith(
    caches.match(event.request, MATCH).then((cached) => {
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
