import { cn } from "../../lib/cn";

const TONE = {
  neutral: "text-ink-primary",
  positive: "text-success",
  negative: "text-danger",
  pending: "text-warning",
};

const SIZE = {
  caption: "text-caption",
  body: "text-body",
  h3: "text-h3 font-semibold",
  metric: "text-metric font-bold",
};

function formatKes(value) {
  const n = Math.abs(Number(value) || 0);
  const formatted = new Intl.NumberFormat("en-KE", { maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  return `KES ${formatted}`;
}

/**
 * Spec §8.1: money is NEVER a bare number. variant sets both color and the
 * leading sign — 'negative' always gets a leading minus, zero is always
 * neutral-toned regardless of the requested variant.
 */
export default function MoneyText({ value, variant = "neutral", size = "body", className }) {
  const isZero = Number(value) === 0;
  const tone = isZero ? "text-ink-secondary" : TONE[variant];
  const sign = variant === "negative" && !isZero ? "− " : "";

  return (
    <span className={cn("tabular-nums", tone, SIZE[size], className)}>
      {sign}
      {formatKes(value)}
    </span>
  );
}
