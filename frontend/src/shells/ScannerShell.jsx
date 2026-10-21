import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";

// Scanner PWA (spec.md §6): dark, high contrast, kiosk-style — no sidebar,
// no theme toggle. Each screen (Sync, Scan) owns its own header/chrome since
// spec §6.1/§6.2 define different headers per screen, not one shared shell.
export default function ScannerShell() {
  // Work Order 05 B4 — registered only here, not app-wide: the other four
  // surfaces run on data that's supposed to be fresh on every load (mock
  // or real), and a service worker caching their shell too is a change
  // with no corresponding product ask. Scanning the registration starts
  // the moment someone visits any /scanner route, same as any real PWA.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability is a nice-to-have, not load-bearing — the
        // validation path makes no network calls either way and does not
        // depend on this registration succeeding.
      });
    }
  }, []);

  return (
    <ThemeProvider surfaceDefault="dark">
      <main className="min-h-screen app-backdrop text-ink-primary">
        <Outlet />
      </main>
    </ThemeProvider>
  );
}
