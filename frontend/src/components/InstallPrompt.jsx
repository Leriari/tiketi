import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Drawer, Button } from "./ui";
import BrandMark from "./BrandMark";

const HAS_PURCHASED_KEY = "chaintix_has_purchased";
const DISMISSED_KEY = "chaintix_install_prompt_dismissed";

/** Call this once a purchase completes (Confirmation.jsx) — the prompt only ever appears after that, never on first visit, per spec.md §3.2. */
export function markFirstPurchase() {
  localStorage.setItem(HAS_PURCHASED_KEY, "1");
}

const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone);

/** Dismissible bottom sheet — mounted once in AttendeeShell. */
export default function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    function onBeforeInstall(e) {
      e.preventDefault();
      deferredPrompt.current = e;
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    if (localStorage.getItem(HAS_PURCHASED_KEY) !== "1") return;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setOpen(false);
  }

  async function install() {
    if (deferredPrompt.current) {
      deferredPrompt.current.prompt();
      await deferredPrompt.current.userChoice;
      deferredPrompt.current = null;
    }
    dismiss();
  }

  return (
    <Drawer open={open} onClose={dismiss} side="bottom">
      <div className="flex items-center gap-3">
        <BrandMark size={44} />
        <div className="flex-1">
          <p className="text-body font-semibold text-ink-primary">Install ChainTix</p>
          <p className="text-caption text-ink-tertiary">Get your tickets in one tap, even offline at the gate.</p>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="ghost" onClick={dismiss} className="flex-1">Not now</Button>
        <Button variant="primary" iconLeft={<Download size={14} />} onClick={install} className="flex-1">Install</Button>
      </div>
    </Drawer>
  );
}
