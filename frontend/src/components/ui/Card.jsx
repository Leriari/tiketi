import { cn } from "../../lib/cn";

/** emphasised: 1px brand-accent border @40% + brand-accent @4% bg — spec says use once per page, max. */
export default function Card({ emphasised = false, padding = "p-5", className, children, ...props }) {
  return (
    <div
      className={cn(
        "rounded-md bg-surface border shadow-card",
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
