// WCAG contrast check for every text/background pairing the components use,
// in both themes, read straight from src/styles/tokens.css. Translucent
// tints (badge backgrounds etc.) are composited over the surface they sit
// on before measuring. Exits non-zero if anything is under 4.5:1.
//
//   node scripts/check-contrast.mjs
import fs from "fs";

const css = fs.readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start + selector.length + 2, css.indexOf("\n}", start));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const dark = block(":root");
const light = { ...dark, ...block('[data-theme="light"]') };

function resolve(vars, value) {
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  return ref ? resolve(vars, vars[ref[1]]) : value;
}

function parse(color) {
  if (color.startsWith("#")) {
    const h = color.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) throw new Error(`Can't parse colour ${color}`);
  const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}

function over(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + bottom[i] * (1 - a))).concat(1);
}

function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function withAlpha(hex, alpha) {
  const [r, g, b] = parse(hex);
  return [r, g, b, alpha];
}

const SURFACES = ["bg-base", "bg-surface", "bg-elevated", "bg-inset"];

function checks(vars) {
  const c = (name) => parse(resolve(vars, vars[name]));
  const raw = (name) => resolve(vars, vars[name]);
  const out = [];
  for (const surface of SURFACES) {
    for (const ink of ["text-primary", "text-secondary", "text-tertiary"]) out.push([`${ink} on ${surface}`, c(ink), c(surface)]);
  }
  for (const surface of ["bg-surface", "bg-elevated"]) {
    // Plain coloured text (MoneyText, icons with labels, links).
    for (const tone of ["success", "danger", "warning", "info", "chain-verified", "brand-primary-on-tint"]) {
      out.push([`${tone} text on ${surface}`, c(tone), c(surface)]);
    }
    // Badges: tone-on-tint over the surface.
    for (const tone of ["success", "warning", "danger", "info"]) {
      const tint = over(c(`${tone}-bg`), c(surface));
      out.push([`${tone}-on-tint on ${tone}-bg / ${surface}`, c(`${tone}-on-tint`), tint]);
    }
    out.push([`brand-primary-on-tint on brand 10% / ${surface}`, c("brand-primary-on-tint"), over(withAlpha(raw("brand-primary"), 0.1), c(surface))]);
    out.push([`brand-primary-on-tint on brand 15% / ${surface}`, c("brand-primary-on-tint"), over(withAlpha(raw("brand-primary"), 0.15), c(surface))]);
    out.push([`chain-verified on its 10% tint / ${surface}`, c("chain-verified"), over(withAlpha(raw("chain-verified"), 0.1), c(surface))]);
  }
  out.push(["white on brand-primary-solid", [255, 255, 255, 1], c("brand-primary-solid")]);
  out.push(["accent-ink on brand-accent", c("brand-accent-ink"), c("brand-accent")]);
  return out;
}

let failures = 0;
for (const [theme, vars] of [["dark", dark], ["light", light]]) {
  console.log(`\n${theme}`);
  for (const [label, fg, bg] of checks(vars)) {
    const r = ratio(fg, bg);
    const ok = r >= 4.5;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  ${label}`);
  }
}
console.log(failures ? `\n${failures} pairing(s) below 4.5:1` : "\nAll pairings meet WCAG AA (4.5:1).");
process.exit(failures ? 1 : 0);
