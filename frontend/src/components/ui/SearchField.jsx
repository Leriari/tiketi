import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";

export default function SearchField({ value, onChange, placeholder = "Search…", className }) {
  return (
    <div className={cn("relative", className)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-10 rounded-sm bg-surface-inset border border-line pl-9 pr-9 text-body text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-primary"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
