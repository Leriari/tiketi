import { cn } from "../../lib/cn";

/** items: [{ value, label, count }] */
export default function Tabs({ items, value, onChange, className }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1 rounded-md bg-surface-inset p-1", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-body-sm font-semibold transition-colors duration-150",
            value === item.value ? "bg-surface text-ink-primary shadow-card" : "text-ink-secondary hover:text-ink-primary"
          )}
        >
          {item.label}
          {item.count != null && (
            <span className="tabular-nums text-caption text-ink-tertiary">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
