import { Check, X, Clock, ExternalLink } from "lucide-react";

/** A block-explorer link (opens in a new tab); just the text when there's no URL. */
export function ExplorerLink({ href, children }) {
  if (!href) return children;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-primary-on-tint hover:underline">
      {children} <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

/**
 * The result of reading something back from the contract: a headline and
 * one line per check — passed, failed, or still being recorded.
 * result: { all_passed, checks: [{ label, pass, pending }] }
 */
export default function ChainChecks({ result, passedText = "Everything matches the blockchain.", failedText = "Something doesn't match. Contact ChainTix support." }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className={`text-body-sm font-semibold ${result.all_passed ? "text-chain-verified" : "text-danger"}`}>
        {result.all_passed ? passedText : failedText}
      </p>
      <ul className="flex flex-col gap-1.5">
        {result.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-body-sm text-ink-secondary">
            {c.pass ? <Check size={15} className="text-chain-verified flex-none mt-0.5" aria-label="Passed" />
              : c.pending ? <Clock size={15} className="text-warning flex-none mt-0.5" aria-label="Pending" />
                : <X size={15} className="text-danger flex-none mt-0.5" aria-label="Failed" />}
            <span>{c.label}{c.pending ? " (being recorded)" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
