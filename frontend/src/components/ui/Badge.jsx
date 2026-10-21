import { cn } from "../../lib/cn";

// 9 semantic tones per spec §2.4.
const TONES = {
  success: "bg-success-bg text-success-on-tint",
  warning: "bg-warning-bg text-warning-on-tint",
  danger: "bg-danger-bg text-danger-on-tint",
  info: "bg-info-bg text-info-on-tint",
  brand: "bg-brand-primary/10 text-brand-primary-on-tint",
  accent: "bg-brand-accent/15 text-brand-accent",
  verified: "bg-chain-verified/10 text-chain-verified",
  pending: "bg-chain-pending/10 text-chain-pending",
  neutral: "bg-surface-elevated text-ink-secondary",
};

export default function Badge({ tone = "neutral", icon, children, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-2 py-[3px] font-mono text-[11px] leading-none font-medium uppercase tracking-[0.06em]",
        TONES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
