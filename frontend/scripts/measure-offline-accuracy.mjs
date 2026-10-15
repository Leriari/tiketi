#!/usr/bin/env node
// Work Order 05 B3 — the offline-validation measurement harness.
//
// Generates a known set of valid and invalid credentials, runs every one
// of them through the real validate.js (not a re-implementation of its
// logic), and reports total validated, correct accepts, correct rejects,
// false accepts (project threshold: zero), false rejects, accuracy %,
// and mean/p95 validation time. Prints a table and writes a JSON file per
// scale. Run with: node scripts/measure-offline-accuracy.mjs
//
// Same Node-environment setup as validate.offline.test.js (fake-indexeddb,
// a minimal localStorage polyfill) — this harness exercises the identical
// code path that test proves makes zero network calls; it is not a
// separate simulation of validate.js's behaviour.

import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const { validate } = await import("../src/scanner/validate.js");
const { computeTotp } = await import("../src/scanner/totp.js");
const { replaceCredentials, wipeAll } = await import("../src/scanner/credentialStore.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "..", "docs", "evaluation");

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function makeSecret(i) {
  // Same deterministic-but-distinct generator as validate.offline.test.js,
  // not a fabricated or hand-picked one — every "valid" credential in this
  // harness carries a real, independently-computable TOTP secret.
  let out = "";
  let n = i + 1;
  for (let pos = 0; pos < 32; pos++) {
    out += BASE32_CHARS[(n + pos * 7) % BASE32_CHARS.length];
    n = (n * 31 + pos) % 100000;
  }
  return out;
}

// ── Scenario mix ─────────────────────────────────────────────────────────
// Every scenario has a known ground truth (should this be GRANTED or not)
// so the harness can score its own result against reality, not just count
// outcomes. Proportions are fixed, not random, so a run at any scale is
// reproducible and comparable to another scale.
const MIX = [
  { name: "valid_first_scan", weight: 0.70, shouldGrant: true },
  { name: "expired_or_wrong_otp", weight: 0.10, shouldGrant: false },
  { name: "already_admitted", weight: 0.10, shouldGrant: false },
  { name: "unknown_ticket", weight: 0.05, shouldGrant: false },
  { name: "malformed_payload", weight: 0.05, shouldGrant: false },
];

function buildPlan(n) {
  // Deterministic allocation (largest-remainder rounding), not random
  // sampling — reproducible at every scale.
  const counts = MIX.map((s) => Math.floor(s.weight * n));
  let allocated = counts.reduce((a, b) => a + b, 0);
  let i = 0;
  while (allocated < n) {
    counts[i % counts.length] += 1;
    allocated += 1;
    i += 1;
  }
  const plan = [];
  MIX.forEach((s, idx) => {
    for (let k = 0; k < counts[idx]; k++) plan.push({ scenario: s.name, shouldGrant: s.shouldGrant });
  });
  return plan;
}

async function runAtScale(n) {
  await wipeAll();

  // Every scenario that needs a *real* credential on the device (valid,
  // expired-otp, already-admitted) draws from this synced set — matching
  // how a real device only ever has its own synced tickets to check
  // against. unknown_ticket and malformed_payload deliberately do not.
  //
  // Sized to the exact number of jobs that will need one, with each job
  // getting its own ticket (no reuse): these three scenarios are mutually
  // exclusive per ticket, so the same ticket must never serve two of
  // them — reusing one (e.g. the already_admitted pre-admit step consuming
  // a ticket a later valid_first_scan job also drew) would make a
  // legitimate first scan look like a repeat and wrongly deny it.
  const realCredentialWeight = MIX
    .filter((s) => s.name === "valid_first_scan" || s.name === "expired_or_wrong_otp" || s.name === "already_admitted")
    .reduce((sum, s) => sum + s.weight, 0);
  const ticketCount = Math.max(1, Math.ceil(n * realCredentialWeight) + 1);
  const tickets = Array.from({ length: ticketCount }, (_, i) => ({
    id: `ticket-${i}`,
    tier_name: i % 2 === 0 ? "General" : "VIP",
    seat_number: null,
    gate_assignment: null,
    totp_secret: makeSecret(i),
    status: "active",
  }));
  await replaceCredentials(tickets);

  const plan = buildPlan(n);
  let ticketCursor = 0;
  const alreadyAdmittedIds = new Set();

  const jobs = [];
  for (const item of plan) {
    if (item.scenario === "malformed_payload") {
      jobs.push({ ...item, payload: "not-a-real-payload" });
      continue;
    }
    if (item.scenario === "unknown_ticket") {
      const code = await computeTotp(makeSecret(999999), Math.floor(Date.now() / 1000));
      jobs.push({ ...item, payload: `TIKETI:ticket-does-not-exist-${Math.random()}:${code}` });
      continue;
    }

    const t = tickets[ticketCursor];
    ticketCursor += 1;
    if (ticketCursor > tickets.length) {
      throw new Error("ticket pool exhausted — sizing bug in buildPlan/ticketCount");
    }

    if (item.scenario === "valid_first_scan") {
      const code = await computeTotp(t.totp_secret, Math.floor(Date.now() / 1000));
      jobs.push({ ...item, payload: `TIKETI:${t.id}:${code}`, ticketId: t.id });
    } else if (item.scenario === "expired_or_wrong_otp") {
      // A code from 10 minutes ago — well outside the ±1 step (90s) window.
      const staleCode = await computeTotp(t.totp_secret, Math.floor(Date.now() / 1000) - 600);
      jobs.push({ ...item, payload: `TIKETI:${t.id}:${staleCode}`, ticketId: t.id });
    } else if (item.scenario === "already_admitted") {
      alreadyAdmittedIds.add(t.id);
      const code = await computeTotp(t.totp_secret, Math.floor(Date.now() / 1000));
      jobs.push({ ...item, payload: `TIKETI:${t.id}:${code}`, ticketId: t.id, preAdmit: true });
    }
  }

  // Pre-admit the "already admitted" tickets for real, via validate() itself
  // (not a direct store write) — so the first grant is a genuine earlier
  // scan, and the measured job below is a genuine repeat.
  for (const job of jobs) {
    if (job.preAdmit) {
      await validate(job.payload, {});
    }
  }

  const results = [];
  const timingsMs = [];

  for (const job of jobs) {
    const start = process.hrtime.bigint();
    const verdict = await validate(job.payload, {});
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    timingsMs.push(elapsedMs);
    results.push({ scenario: job.scenario, shouldGrant: job.shouldGrant, granted: verdict.granted, reasonCode: verdict.reasonCode });
  }

  let correctAccepts = 0, correctRejects = 0, falseAccepts = 0, falseRejects = 0;
  const rejectReasonCounts = {};
  for (const r of results) {
    if (r.shouldGrant && r.granted) correctAccepts += 1;
    else if (!r.shouldGrant && !r.granted) {
      correctRejects += 1;
      rejectReasonCounts[r.reasonCode] = (rejectReasonCounts[r.reasonCode] || 0) + 1;
    } else if (!r.shouldGrant && r.granted) falseAccepts += 1;
    else if (r.shouldGrant && !r.granted) falseRejects += 1;
  }

  timingsMs.sort((a, b) => a - b);
  const mean = timingsMs.reduce((a, b) => a + b, 0) / timingsMs.length;
  const p95 = timingsMs[Math.min(timingsMs.length - 1, Math.floor(timingsMs.length * 0.95))];

  return {
    scale: n,
    totalValidated: results.length,
    correctAccepts,
    correctRejects,
    falseAccepts,
    falseRejects,
    accuracyPercent: ((correctAccepts + correctRejects) / results.length) * 100,
    meanValidationMs: mean,
    p95ValidationMs: p95,
    rejectReasonBreakdown: rejectReasonCounts,
  };
}

function printTable(rows) {
  const cols = [
    ["scale", "Scale"], ["totalValidated", "Total"], ["correctAccepts", "Correct accepts"],
    ["correctRejects", "Correct rejects"], ["falseAccepts", "False accepts"],
    ["falseRejects", "False rejects"], ["accuracyPercent", "Accuracy %"],
    ["meanValidationMs", "Mean ms"], ["p95ValidationMs", "p95 ms"],
  ];
  const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v));
  const widths = cols.map(([key, label]) => Math.max(label.length, ...rows.map((r) => fmt(r[key]).length)));

  const line = (cells) => cells.map((c, i) => c.padStart(widths[i])).join("  |  ");
  console.log(line(cols.map(([, label]) => label)));
  console.log(widths.map((w) => "-".repeat(w)).join("--+--"));
  for (const r of rows) console.log(line(cols.map(([key]) => fmt(r[key]))));
}

async function main() {
  const scales = [100, 1000, 5000];
  const rows = [];
  for (const n of scales) {
    const result = await runAtScale(n);
    rows.push(result);
    console.log(`\n=== scale ${n} ===`);
    console.log(`False accepts: ${result.falseAccepts} (threshold: 0) — ${result.falseAccepts === 0 ? "PASS" : "FAIL"}`);
    console.log("Reject reason breakdown:", result.rejectReasonBreakdown);
  }

  console.log("\n=== Summary ===");
  printTable(rows);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, "offline-accuracy.json");
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), results: rows }, null, 2));
  console.log(`\nWrote ${outFile}`);

  const anyFalseAccepts = rows.some((r) => r.falseAccepts > 0);
  if (anyFalseAccepts) {
    console.error("\nFAILED: false accepts above the zero threshold.");
    process.exitCode = 1;
  }
}

await main();
