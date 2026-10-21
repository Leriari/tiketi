import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

// docs/design-principles.md: lime is the only "do this" colour and the
// only button that glows (P3); everything else is a quiet hairline (P2).
const VARIANTS = {
  primary: "bg-brand-accent text-brand-accent-ink hover:shadow-glow-accent hover:brightness-[1.03] disabled:opacity-40 disabled:shadow-none",
  secondary: "bg-surface text-ink-primary border border-line shadow-highlight hover:border-line-strong hover:bg-surface-elevated disabled:opacity-40",
  ghost: "bg-transparent text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary disabled:opacity-40",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-40",
};

const SIZES = {
  sm: "h-8 px-3 text-body-sm gap-1.5",
  md: "h-10 px-4 text-body gap-2",
  lg: "h-12 px-5 text-h3 gap-2",
};

const ICON_ONLY_SIZES = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" };

const Button = forwardRef(function Button(
  { variant = "primary", size = "md", loading = false, iconLeft, iconOnly = false, className, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-semibold tracking-[-0.01em] rounded-md transition-[background-color,border-color,box-shadow,filter,transform] duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
        VARIANTS[variant],
        iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" size={size === "sm" ? 14 : 16} /> : iconLeft}
      {!iconOnly && children}
      {iconOnly && !loading && children}
    </button>
  );
});

export default Button;
