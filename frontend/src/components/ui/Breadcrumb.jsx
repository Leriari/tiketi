import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

/** items: [{ label, to }] — last item renders as plain text (current page). */
export default function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-body-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={13} className="text-ink-tertiary" />}
            {isLast || !item.to ? (
              <span aria-current={isLast ? "page" : undefined} className="text-ink-primary font-medium">
                {item.label}
              </span>
            ) : (
              <Link to={item.to} className="text-ink-secondary hover:text-ink-primary">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
