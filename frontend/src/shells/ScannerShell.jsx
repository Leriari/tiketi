import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";
import { enableOfflineShell } from "../lib/offlineShell";

// Scanner PWA (spec.md §6): dark, high contrast, kiosk-style — no sidebar,
// no theme toggle. Each screen (Sync, Scan) owns its own header/chrome since
// spec §6.1/§6.2 define different headers per screen, not one shared shell.
export default function ScannerShell() {
  // Work Order 05 B4: the scanner must open with no connection. The
  // validation path makes no network calls either way and doesn't depend
  // on this registration succeeding.
  useEffect(() => {
    enableOfflineShell();
  }, []);

  return (
    <ThemeProvider surfaceDefault="dark">
      <main className="min-h-screen app-backdrop text-ink-primary">
        <Outlet />
      </main>
    </ThemeProvider>
  );
}
