/**
 * Every color resolves through a CSS custom property defined in
 * src/styles/tokens.css, so switching [data-theme] on <html> repaints
 * every utility class live — no JS re-render needed for a theme change.
 *
 * Group names here are chosen for ergonomic class names (bg-surface-base,
 * text-ink-primary, border-line) — the underlying --css-var names still
 * match the spec exactly (--bg-base, --text-primary, --border-default).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      // spec §2.1: sidebar collapses to a 64px icon rail below 1280px (xl),
      // becomes an off-canvas drawer below 900px — 900 isn't a stock
      // breakpoint, so it's added here under its own name.
      screens: {
        sidebar: "900px",
      },
      colors: {
        surface: {
          base: "var(--bg-base)",
          DEFAULT: "var(--bg-surface)",
          elevated: "var(--bg-elevated)",
          inset: "var(--bg-inset)",
        },
        line: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        ink: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          disabled: "var(--text-disabled)",
        },
        brand: {
          primary: "var(--brand-primary)",
          // A slightly shifted shade for brand-colored TEXT sitting on the
          // brand's own 10-15% tint background (active nav, badge pills) —
          // --brand-primary itself only clears ~3.6-3.9:1 there, short of
          // §8.6's 4.5:1. See tokens.css for the per-theme values.
          "primary-on-tint": "var(--brand-primary-on-tint)",
          // Solid-fill variant (selected chip, pagination, step indicator) —
          // white text on raw brand-primary is only 4.35:1, short of 4.5:1.
          "primary-solid": "var(--brand-primary-solid)",
          accent: "var(--brand-accent)",
          "accent-ink": "var(--brand-accent-ink)",
        },
        // "-on-tint" is for text sitting on that same color's *-bg (Badge and
        // similar) — the base color alone doesn't clear 4.5:1 there in every
        // theme. Use the base color everywhere else (MoneyText, icons, plain text).
        success: { DEFAULT: "var(--success)", bg: "var(--success-bg)", "on-tint": "var(--success-on-tint)" },
        warning: { DEFAULT: "var(--warning)", bg: "var(--warning-bg)", "on-tint": "var(--warning-on-tint)" },
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)", "on-tint": "var(--danger-on-tint)" },
        info: { DEFAULT: "var(--info)", bg: "var(--info-bg)", "on-tint": "var(--info-on-tint)" },
        chain: { verified: "var(--chain-verified)", pending: "var(--chain-pending)" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        display: ["34px", { lineHeight: "1.15" }],
        h1: ["26px", { lineHeight: "1.2" }],
        h2: ["20px", { lineHeight: "1.3" }],
        h3: ["16px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.55" }],
        "body-sm": ["13px", { lineHeight: "1.5" }],
        label: ["11px", { lineHeight: "1.3", letterSpacing: "0.06em" }],
        metric: ["30px", { lineHeight: "1.1" }],
        caption: ["12px", { lineHeight: "1.4" }],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,23,26,0.05)",
        modal: "0 8px 24px rgba(20,23,26,0.12)",
      },
      transitionDuration: { 220: "220ms" },
      transitionTimingFunction: {
        panel: "cubic-bezier(0.32,0.72,0,1)",
      },
      spacing: {
        18: "72px",
        // sidebar rail widths from the spec
        rail: "64px",
        sidebar: "264px",
      },
    },
  },
  plugins: [],
};
