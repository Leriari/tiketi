// THIS FILE IS THE RESEARCH EVIDENCE FOR WORK ORDER 03's CENTRAL CLAIM.
//
// A normal test suite needs no network to pass — that alone proves nothing.
// This one goes further: it replaces fetch, XMLHttpRequest,
// navigator.sendBeacon and WebSocket with stubs that THROW if called, then
// runs 100+ validations (valid, expired, wrong-secret, malformed,
// already-admitted, wrong-gate) through the real validate.js and asserts
// none of those stubs were ever invoked. If someone later adds a
// "just check with the server too" branch inside the validation path, this
// test — not a human reviewer — is what breaks the build. Do not delete
// this file as redundant with the rest of the suite; the point is what it
// proves about validate.js specifically, not general network-free testing.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Node's test environment has no localStorage (a browser/DOM API) —
// credentialStore.js uses it for the one small sync-metadata object (see
// its own header comment for why that's localStorage and not IndexedDB).
// A 4-method in-memory stand-in is simpler than pulling in jsdom for this
// alone, matching the work order's own "write it, don't add a dependency"
// spirit for small, well-understood browser primitives.
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
import { validate, parsePayload, REASON } from "../validate";
import { computeTotp } from "../totp";
import { replaceCredentials, wipeAll } from "../credentialStore";

const EVENT_ID = "test-event-1";
const TICKET_COUNT = 20;

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // no 0/1/8/9 — not valid base32

function makeSecret(i) {
  // A distinct, valid base32 secret per ticket (32 chars, matching
  // generate_totp_secret()'s real output length) — built from `i` so each
  // ticket's secret is genuinely different, letting a wrong-secret test
  // use another real ticket's secret rather than a fabricated one.
  let out = "";
  let n = i + 1;
  for (let pos = 0; pos < 32; pos++) {
    out += BASE32_CHARS[(n + pos * 7) % BASE32_CHARS.length];
    n = (n * 31 + pos) % 100000;
  }
  return out;
}

function buildTickets() {
  return Array.from({ length: TICKET_COUNT }, (_, i) => ({
    id: `ticket-${i}`,
    tier_name: i % 2 === 0 ? "General" : "VIP",
    seat_number: null,
    gate_assignment: i < 2 ? "Gate A" : null, // first two tickets ARE gate-restricted
    totp_secret: makeSecret(i),
    status: "active",
  }));
}

let networkStubs;

beforeAll(() => {
  // Network primitives, stubbed to throw — see file header. Stored so each
  // test can assert on call count, and so cleanup can restore them exactly.
  networkStubs = {
    fetch: vi.fn(() => {
      throw new Error("NETWORK CALL ATTEMPTED: fetch() inside the offline validation path");
    }),
    XMLHttpRequest: vi.fn(() => {
      throw new Error("NETWORK CALL ATTEMPTED: XMLHttpRequest inside the offline validation path");
    }),
    sendBeacon: vi.fn(() => {
      throw new Error("NETWORK CALL ATTEMPTED: navigator.sendBeacon inside the offline validation path");
    }),
    WebSocket: vi.fn(() => {
      throw new Error("NETWORK CALL ATTEMPTED: WebSocket inside the offline validation path");
    }),
  };

  globalThis.fetch = networkStubs.fetch;
  globalThis.XMLHttpRequest = networkStubs.XMLHttpRequest;
  globalThis.WebSocket = networkStubs.WebSocket;
  // Node's built-in `navigator` global has no setter, only its properties
  // are writable — can't reassign navigator itself, only patch onto it.
  if (!globalThis.navigator) globalThis.navigator = {};
  globalThis.navigator.sendBeacon = networkStubs.sendBeacon;
});

beforeEach(async () => {
  await wipeAll();
  await replaceCredentials(buildTickets());
});

afterEach(() => {
  for (const stub of Object.values(networkStubs)) stub.mockClear();
});

function assertNoNetworkCalls() {
  for (const [name, stub] of Object.entries(networkStubs)) {
    expect(stub, `${name} was called from inside the offline validation path`).not.toHaveBeenCalled();
  }
}

describe("validate() — offline, no network, ever", () => {
  it("parsePayload: well-formed payload parses, everything else returns null", () => {
    expect(parsePayload("TIKETI:ticket-0:123456")).toEqual({ ticketId: "ticket-0", otp: "123456" });
    expect(parsePayload("")).toBeNull();
    expect(parsePayload("not-a-payload")).toBeNull();
    expect(parsePayload("TIKETI:only-one-part")).toBeNull();
    expect(parsePayload("WRONGPREFIX:ticket-0:123456")).toBeNull();
    expect(parsePayload("TIKETI::123456")).toBeNull();
    assertNoNetworkCalls();
  });

  it("grants a valid, never-before-seen ticket at the current TOTP window", async () => {
    const secret = makeSecret(5);
    const otp = await computeTotp(secret, Math.floor(Date.now() / 1000));
    const result = await validate(`TIKETI:ticket-5:${otp}`);
    expect(result.granted).toBe(true);
    expect(result.reasonCode).toBe(REASON.GRANTED);
    expect(result.ticketId).toBe("ticket-5");
    assertNoNetworkCalls();
  });

  it("accepts the window one step in the past and one step in the future (drift tolerance)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const secretPast = makeSecret(6);
    const otpPast = await computeTotp(secretPast, now - 30);
    const resultPast = await validate(`TIKETI:ticket-6:${otpPast}`);
    expect(resultPast.granted).toBe(true);

    const secretFuture = makeSecret(7);
    const otpFuture = await computeTotp(secretFuture, now + 30);
    const resultFuture = await validate(`TIKETI:ticket-7:${otpFuture}`);
    expect(resultFuture.granted).toBe(true);
    assertNoNetworkCalls();
  });

  it("rejects a code two steps out of range as BAD_OTP (outside the ±1 window)", async () => {
    const secret = makeSecret(8);
    const expiredOtp = await computeTotp(secret, Math.floor(Date.now() / 1000) - 90);
    const result = await validate(`TIKETI:ticket-8:${expiredOtp}`);
    expect(result.granted).toBe(false);
    expect(result.reasonCode).toBe(REASON.BAD_OTP);
    assertNoNetworkCalls();
  });

  it("rejects a correctly-formatted code computed from the WRONG ticket's secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wrongSecretOtp = await computeTotp(makeSecret(2), now); // ticket-9's real secret is makeSecret(9)
    const result = await validate(`TIKETI:ticket-9:${wrongSecretOtp}`);
    expect(result.granted).toBe(false);
    expect(result.reasonCode).toBe(REASON.BAD_OTP);
    assertNoNetworkCalls();
  });

  it("rejects an unknown ticket id not present in the synced cache", async () => {
    const result = await validate("TIKETI:never-synced-ticket:123456");
    expect(result.granted).toBe(false);
    expect(result.reasonCode).toBe(REASON.UNKNOWN_TICKET);
    assertNoNetworkCalls();
  });

  it("rejects malformed payloads as INVALID_FORMAT", async () => {
    for (const bad of ["", "garbage", "TIKETI:onlyone", "NOTTIKETI:ticket-0:123456", "TIKETI:ticket-0:"]) {
      const result = await validate(bad);
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.INVALID_FORMAT);
    }
    assertNoNetworkCalls();
  });

  it("the second scan of an already-admitted ticket is rejected as ALREADY_ADMITTED", async () => {
    const secret = makeSecret(10);
    const now = Math.floor(Date.now() / 1000);

    const firstOtp = await computeTotp(secret, now);
    const first = await validate(`TIKETI:ticket-10:${firstOtp}`);
    expect(first.granted).toBe(true);

    // A fresh, independently-valid OTP for the same ticket a moment later —
    // proves the rejection is the admission record, not a stale/reused code.
    const secondOtp = await computeTotp(secret, now);
    const second = await validate(`TIKETI:ticket-10:${secondOtp}`);
    expect(second.granted).toBe(false);
    expect(second.reasonCode).toBe(REASON.ALREADY_ADMITTED);
    assertNoNetworkCalls();
  });

  it("rejects a ticket assigned to a different gate than the one scanning it", async () => {
    // ticket-0 and ticket-1 are built with gate_assignment: "Gate A"
    const secret = makeSecret(0);
    const otp = await computeTotp(secret, Math.floor(Date.now() / 1000));
    const result = await validate(`TIKETI:ticket-0:${otp}`, { gateName: "Gate B" });
    expect(result.granted).toBe(false);
    expect(result.reasonCode).toBe(REASON.WRONG_GATE);
    assertNoNetworkCalls();
  });

  it("grants a gate-assigned ticket when scanned at ITS OWN gate", async () => {
    const secret = makeSecret(1);
    const otp = await computeTotp(secret, Math.floor(Date.now() / 1000));
    const result = await validate(`TIKETI:ticket-1:${otp}`, { gateName: "Gate A" });
    expect(result.granted).toBe(true);
    assertNoNetworkCalls();
  });

  it("runs 100+ validations across every category with zero network calls at any point", async () => {
    let total = 0;
    const now = Math.floor(Date.now() / 1000);

    // Valid, first-time scans — one per seeded ticket (20).
    for (let i = 0; i < TICKET_COUNT; i++) {
      const otp = await computeTotp(makeSecret(i), now);
      const gateName = i < 2 ? "Gate A" : undefined;
      const result = await validate(`TIKETI:ticket-${i}:${otp}`, { gateName });
      expect(result.granted).toBe(true);
      total++;
    }

    // Repeat the same scans — every one must now be ALREADY_ADMITTED (20).
    for (let i = 0; i < TICKET_COUNT; i++) {
      const otp = await computeTotp(makeSecret(i), now);
      const gateName = i < 2 ? "Gate A" : undefined;
      const result = await validate(`TIKETI:ticket-${i}:${otp}`, { gateName });
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.ALREADY_ADMITTED);
      total++;
    }

    // Expired codes against a fresh set of tickets (re-seed first) (20).
    await replaceCredentials(buildTickets());
    for (let i = 0; i < TICKET_COUNT; i++) {
      const expiredOtp = await computeTotp(makeSecret(i), now - 300);
      const result = await validate(`TIKETI:ticket-${i}:${expiredOtp}`);
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.BAD_OTP);
      total++;
    }

    // Wrong-secret codes — each ticket's payload carries a code computed
    // from the NEXT ticket's secret (20).
    for (let i = 0; i < TICKET_COUNT; i++) {
      const wrongOtp = await computeTotp(makeSecret((i + 1) % TICKET_COUNT), now);
      const result = await validate(`TIKETI:ticket-${i}:${wrongOtp}`);
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.BAD_OTP);
      total++;
    }

    // Malformed payloads (20, cycling through a few shapes).
    const malformed = ["", "garbage", "TIKETI:x", "NOPE:ticket-0:111111", "TIKETI::111111"];
    for (let i = 0; i < TICKET_COUNT; i++) {
      const result = await validate(malformed[i % malformed.length]);
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.INVALID_FORMAT);
      total++;
    }

    // Unknown tickets (10).
    for (let i = 0; i < 10; i++) {
      const result = await validate(`TIKETI:does-not-exist-${i}:111111`);
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.UNKNOWN_TICKET);
      total++;
    }

    // Wrong-gate (10) — full wipe (not just replaceCredentials, which
    // leaves the admissions store untouched) so ticket-0's admission from
    // the very first loop above doesn't make this fail for the wrong reason.
    await wipeAll();
    await replaceCredentials(buildTickets());
    for (let i = 0; i < 10; i++) {
      const otp = await computeTotp(makeSecret(0), now);
      const result = await validate(`TIKETI:ticket-0:${otp}`, { gateName: "Gate B" });
      expect(result.granted).toBe(false);
      expect(result.reasonCode).toBe(REASON.WRONG_GATE);
      total++;
    }

    expect(total).toBeGreaterThanOrEqual(100);
    assertNoNetworkCalls();
  });
});
