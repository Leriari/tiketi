import { cn } from "../../lib/cn";

/** emphasised: the one card per page that matters most (P1) — lime hairline + faint lime wash. */
export default function Card({ emphasised = false, padding = "p-5", className, children, ...props }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-surface border shadow-card",
        emphasised ? "border-brand-accent/40 bg-brand-accent/[0.04]" : "border-line-subtle",
        padding,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
