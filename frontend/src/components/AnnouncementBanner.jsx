import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const DISMISSED_KEY = "chaintix_dismissed_announcements";

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/**
 * The newest ChainTix announcement (Admin → Communication Center, in-app)
 * addressed to this viewer, until they dismiss it. Renders nothing when
 * there's none, or if announcements can't be loaded — it's never worth an
 * error on someone's page.
 */
export default function AnnouncementBanner() {
  const { isAuthed } = useAuth();
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let cancelled = false;
    api.getAnnouncements?.()
      .then((rows) => { if (!cancelled) setItems(rows || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthed]);

  const current = items.find((a) => !dismissed.has(a.id));
  if (!current) return null;

  function dismiss() {
    const next = new Set(dismissed).add(current.id);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-50)));
    } catch {
      // Private mode: it just comes back next visit.
    }
  }

  return (
    <div role="status" className="border-b border-line-subtle bg-info-bg">
      <div className="mx-auto max-w-6xl px-4 lg:px-6 py-2.5 flex items-start gap-3">
        <Megaphone size={16} className="flex-none mt-0.5 text-info-on-tint" aria-hidden="true" />
        <p className="flex-1 text-body-sm text-ink-primary">{current.message}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="flex-none rounded-sm p-0.5 text-ink-tertiary hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
