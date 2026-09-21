import { X } from "lucide-react";
import { cn } from "../../lib/cn";

/** Selectable filter chip, optionally removable (tag-input style). */
export default function Chip({ selected = false, onClick, onRemove, children, className }) {
  const isButton = Boolean(onClick);
  const Comp = isButton ? "button" : "span";
  return (
    <Comp
      type={isButton ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-body-sm font-medium border transition-colors duration-150",
        selected
          ? "bg-brand-primary-solid text-white border-brand-primary-solid"
          : "bg-surface-inset text-ink-secondary border-line hover:border-line-strong",
        isButton && "cursor-pointer",
        className
      )}
    >
      {children}
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => e.key === "Enter" && onRemove()}
          aria-label="Remove"
          className="hover:opacity-70"
        >
          <X size={12} />
        </span>
      )}
    </Comp>
  );
}
