import { User } from "lucide-react";
import { cn } from "../../lib/cn";

const SIZES = { sm: "h-7 w-7 text-caption", md: "h-9 w-9 text-body-sm", lg: "h-12 w-12 text-h3" };
const ICON_SIZES = { sm: 14, md: 16, lg: 22 };

function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

export default function Avatar({ name, src, size = "md", className }) {
  // Users here are identified by phone number, which has no meaningful
  // initials ("254712…" -> "2") — show a person icon instead.
  const text = /\p{L}/u.test(name || "") ? initials(name) : "";
  // Decorative: it always sits beside the person's name or inside a
  // control that has its own label, so screen readers skip the initials.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary-on-tint font-semibold flex-none overflow-hidden",
        SIZES[size],
        className
      )}
    >
      {src ? (
        <img src={src} alt={name || ""} className="h-full w-full object-cover" />
      ) : (
        text || <User size={ICON_SIZES[size]} aria-hidden="true" />
      )}
    </span>
  );
}
