import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

function pageRange(current, total) {
  const pages = new Set([1, total, current, current - 1, current + 1]);
  return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
}

export default function Pagination({ page, totalPages, onChange, className }) {
  if (totalPages <= 1) return null;
  const pages = pageRange(page, totalPages);

  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-1", className)}>
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-secondary hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={16} />
      </button>

      {pages.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && pages[i - 1] !== p - 1 && <span className="px-1 text-ink-tertiary">…</span>}
          <button
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-sm text-body-sm tabular-nums transition-colors duration-150",
              p === page ? "bg-brand-primary-solid text-white font-semibold" : "text-ink-secondary hover:bg-surface-elevated"
            )}
          >
            {p}
          </button>
        </span>
      ))}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Next page"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-secondary hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
