// Registers the app-shell service worker (public/sw.js) so a surface opens
// with no connection. Used by the scanner and by the attendee app (whose
// ticket screen has to work at a gate with no signal). The worker never
// touches API calls; it only caches the app's own files.
export function enableOfflineShell() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Installability is a nice-to-have: nothing depends on this succeeding.
  });
  // Hand the worker every file this page has loaded so far, so the app
  // still opens after a reload with no signal (see public/sw.js).
  navigator.serviceWorker.ready.then((registration) => {
    const urls = [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)];
    registration.active?.postMessage({ type: "cache-urls", urls });
  });
}
