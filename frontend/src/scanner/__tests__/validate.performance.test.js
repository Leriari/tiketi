// NFR-03 (performance) and NFR-05 (scalability) evidence for the gate:
// how long one offline validation takes on the scanner, with a realistic
// event's worth of credentials in IndexedDB. Runs the real validate.js
// (Web Crypto TOTP + IndexedDB lookups) end to end — format check, TOTP
// window, prior admission, gate — for every scan, and records an admission
// for each one granted, exactly as the Live Scanner does.
//
// fake-indexeddb is an in-memory implementation, so absolute times here
// are for this machine, not a phone; the point is the shape: per-scan time
// that stays flat as the event grows, with no network involved.
// `npm test -- validate.performance` prints the table used in the report.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
import { validate } from "../validate";
import { computeTotp } from "../totp";
import { replaceCredentials, wipeAll, recordAdmission } from "../credentialStore";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SIZES = [100, 1_000, 10_000]; // tickets synced to the device
const SCANS = 500; // validations timed at each size

function secret(i) {
  let out = "";
  let n = i + 7;
  for (let pos = 0; pos < 32; pos++) {
    out += BASE32[(n + pos * 11) % 32];
    n = (n * 33 + pos) % 1_000_003;
  }
  return out;
}

function tickets(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `perf-${i}`, tier_name: "General", seat_number: null, gate_assignment: null, totp_secret: secret(i), status: "active",
  }));
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const results = [];

describe("offline validation performance", () => {
  beforeAll(() => {
    // Any network use here would invalidate the measurement.
    globalThis.fetch = () => { throw new Error("network used during offline validation"); };
  });

  for (const size of SIZES) {
    it(`validates in flat time with ${size.toLocaleString()} tickets on the device`, async () => {
      await wipeAll();
      const all = tickets(size);
      const syncStart = performance.now();
      await replaceCredentials(all);
      const syncMs = performance.now() - syncStart;

      const now = Math.floor(Date.now() / 1000);
      const picks = Array.from({ length: SCANS }, (_, i) => all[(i * 7919) % size]);
      const payloads = await Promise.all(picks.map(async (t) => `TIKETI:${t.id}:${await computeTotp(t.totp_secret, now)}`));

      const times = [];
      let granted = 0;
      for (let i = 0; i < SCANS; i++) {
        const start = performance.now();
        const verdict = await validate(payloads[i]);
        if (verdict.granted) {
          await recordAdmission(picks[i].id, new Date().toISOString());
          granted++;
        }
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const row = {
        tickets: size,
        syncMs: Math.round(syncMs),
        p50: percentile(times, 50),
        p95: percentile(times, 95),
        max: times[times.length - 1],
        perSecond: Math.round(1000 / (times.reduce((s, t) => s + t, 0) / times.length)),
        granted,
      };
      results.push(row);

      // Every distinct ticket is admitted once; repeats are refused as already admitted.
      expect(granted).toBe(new Set(picks.map((t) => t.id)).size);
      // A gate scan must feel instant: well under the 30-second code window,
      // and far below a person walking through a turnstile.
      expect(row.p95).toBeLessThan(250);
    }, 120_000);
  }

  it("prints the measurements", () => {
    console.log("\nOffline gate validation (validate.js: Web Crypto TOTP + IndexedDB, no network)");
    console.table(results.map((r) => ({
      "Tickets on device": r.tickets.toLocaleString(),
      "Sync time (ms)": r.syncMs,
      "p50 per scan (ms)": r.p50.toFixed(2),
      "p95 per scan (ms)": r.p95.toFixed(2),
      "Max (ms)": r.max.toFixed(2),
      "Scans / second": r.perSecond,
    })));
    expect(results).toHaveLength(SIZES.length);
  });
});
