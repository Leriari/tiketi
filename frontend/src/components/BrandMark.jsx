import { cn } from "../lib/cn";

/**
 * The ChainTix mark: a ticket stub with a perforated notch (the product is
 * the ticket — P1) in the action lime. One definition for every surface.
 * withWordmark: adds "ChainTix" beside it.
 */
export default function BrandMark({ size = 28, withWordmark = false, className }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
        <path
          d="M6 4h20a2 2 0 0 1 2 2v7a3 3 0 0 0 0 6v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a3 3 0 0 0 0-6V6a2 2 0 0 1 2-2z"
          fill="var(--brand-accent)"
        />
        <path d="M20.5 11.2A6 6 0 1 0 20.5 20.8" fill="none" stroke="var(--brand-accent-ink)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M23.5 9v2.2M23.5 14.9v2.2M23.5 20.8V23" stroke="var(--brand-accent-ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      </svg>
      {withWordmark && <span className="font-semibold text-h3 tracking-[-0.02em] text-ink-primary">ChainTix</span>}
    </span>
  );
}
