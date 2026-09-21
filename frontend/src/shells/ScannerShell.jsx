import { Outlet } from "react-router-dom";
import { ThemeProvider } from "../theme/ThemeProvider";

// Scanner PWA (spec.md §6): dark, high contrast, kiosk-style — no sidebar,
// no theme toggle. Each screen (Sync, Scan) owns its own header/chrome since
// spec §6.1/§6.2 define different headers per screen, not one shared shell.
export default function ScannerShell() {
  return (
    <ThemeProvider surfaceDefault="dark">
      <main className="min-h-screen bg-surface-base text-ink-primary">
        <Outlet />
      </main>
    </ThemeProvider>
  );
}
