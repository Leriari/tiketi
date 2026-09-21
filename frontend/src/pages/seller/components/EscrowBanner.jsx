import { useState } from "react";
import { Lock, X } from "lucide-react";

const DISMISS_KEY = "chaintix_escrow_banner_dismissed_at";
const RESHOW_AFTER_MS = 30 * 24 * 3600 * 1000;

function shouldShow() {
  const at = localStorage.getItem(DISMISS_KEY);
  if (!at) return true;
  return Date.now() - Number(at) > RESHOW_AFTER_MS;
}

/** Spec §4.1 — persistent at the top of the Seller Dashboard. */
export default function EscrowBanner() {
  const [visible, setVisible] = useState(shouldShow);

  if (!visible) return null;

  return (
    <div className="rounded-md border border-brand-primary/25 bg-brand-primary/5 p-4 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 text-body font-semibold text-ink-primary">
          <Lock size={16} className="text-brand-primary" /> Secure Escrow System
        </span>
        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
            setVisible(false);
          }}
          aria-label="Dismiss"
          className="text-ink-tertiary hover:text-ink-primary"
        >
          <X size={16} />
        </button>
      </div>
      <p className="text-body-sm text-ink-secondary">
        <strong className="text-ink-primary">When your ticket sells:</strong> money appears in your wallet immediately as{" "}
        <strong className="text-ink-primary">Pending</strong>.
      </p>
      <p className="text-body-sm text-ink-secondary">
        <strong className="text-ink-primary">After 2 days:</strong> funds move to <strong className="text-ink-primary">Available</strong> and
        you can withdraw to M-Pesa.
      </p>
      <p className="text-caption text-ink-tertiary">Withdrawals are only available 2 days after the event ends to protect buyers.</p>
    </div>
  );
}
