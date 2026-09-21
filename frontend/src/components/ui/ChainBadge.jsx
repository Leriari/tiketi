import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * status: 'pending' | 'verified' | 'failed'.
 * Spec §8.3: failed renders amber, not red — the ticket still works while a
 * mint retries, so this must never read as an error to an attendee.
 * txUrl: Basescan link, shown only when verified.
 */
export default function ChainBadge({ status = "pending", txUrl, className }) {
  if (status === "verified") {
    return (
      <a
        href={txUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-chain-verified/10 px-2.5 py-1 text-caption font-semibold text-chain-verified hover:underline",
          className
        )}
      >
        <ShieldCheck size={13} /> Verified on-chain
      </a>
    );
  }

  if (status === "failed") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-caption font-semibold text-warning", className)}>
        <RefreshCw size={12} /> Verification retrying
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-caption font-semibold text-warning", className)}>
      <Loader2 size={12} className="animate-spin" /> Securing…
    </span>
  );
}
