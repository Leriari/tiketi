import { cn } from "../../lib/cn";

const SIZES = { sm: "h-7 w-7 text-caption", md: "h-9 w-9 text-body-sm", lg: "h-12 w-12 text-h3" };

function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export default function Avatar({ name, src, size = "md", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary-on-tint font-semibold flex-none overflow-hidden",
        SIZES[size],
        className
      )}
    >
      {src ? <img src={src} alt={name || ""} className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}
