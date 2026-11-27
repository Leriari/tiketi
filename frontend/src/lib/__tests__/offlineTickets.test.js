// The attendee's ticket works at a gate with no signal: the phone saves the
// ticket's QR secret while online, then makes each 30-second code itself,
// and the gate scanner (also offline) accepts it. Network calls are stubbed
// to throw while the phone makes its code, so any hidden server call fails
// the test.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

import {
  saveTicketList, savedTicketList, saveTicket, savedTicket, forgetTicket, forgetTicketSecret,
  hasSavedTickets, clearSavedTickets,
} from "../offlineTickets";
import { computeTotp } from "../../scanner/totp";
import { validate, REASON } from "../../scanner/validate";
import { replaceCredentials, wipeAll } from "../../scanner/credentialStore";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const ticket = (id, status = "active") => ({ id, status, event_title: "Show", venue: "KICC", event_date: "2030-01-01T18:00:00Z" });

beforeEach(() => {
  clearSavedTickets();
});

describe("tickets saved on the phone", () => {
  it("keeps the list and a ticket's secret", () => {
    saveTicketList("u1", [ticket("t1"), ticket("t2")]);
    saveTicket("u1", "t1", { secret: SECRET });
    expect(savedTicketList("u1").tickets).toHaveLength(2);
    expect(savedTicket("u1", "t1").secret).toBe(SECRET);
    // A ticket only seen in the list still opens, with the list's details.
    expect(savedTicket("u1", "t2").detail.ticket_id).toBe("t2");
    expect(hasSavedTickets()).toBe(true);
  });

  it("drops the secret once the ticket is used or listed for resale", () => {
    saveTicketList("u1", [ticket("t1")]);
    saveTicket("u1", "t1", { secret: SECRET });
    saveTicketList("u1", [ticket("t1", "resale")]);
    expect(savedTicket("u1", "t1").secret).toBeNull();

    saveTicket("u1", "t1", { detail: { ticket_id: "t1", status: "active" }, secret: SECRET });
    saveTicket("u1", "t1", { detail: { ticket_id: "t1", status: "used" } });
    expect(savedTicket("u1", "t1").secret).toBeNull();
    // ...and won't take one back while it isn't active.
    saveTicket("u1", "t1", { secret: SECRET });
    expect(savedTicket("u1", "t1").secret).toBeNull();
  });

  it("forgets tickets that left the account", () => {
    saveTicketList("u1", [ticket("t1"), ticket("t2")]);
    saveTicket("u1", "t1", { secret: SECRET });
    saveTicketList("u1", [ticket("t2")]); // t1 was sold
    expect(savedTicket("u1", "t1")).toBeNull();

    saveTicket("u1", "t2", { secret: SECRET });
    forgetTicket("u1", "t2");
    expect(savedTicket("u1", "t2")).toBeNull();
    expect(savedTicketList("u1").tickets).toHaveLength(0);
  });

  it("forgets a secret on its own", () => {
    saveTicket("u1", "t1", { secret: SECRET });
    forgetTicketSecret("u1", "t1");
    expect(savedTicket("u1", "t1")?.secret ?? null).toBeNull();
  });

  it("never shows one account's tickets to another", () => {
    saveTicketList("u1", [ticket("t1")]);
    saveTicket("u1", "t1", { secret: SECRET });
    expect(savedTicket("u2", "t1")).toBeNull();
    expect(savedTicketList("u2")).toBeNull();
    // With no session (expired while offline), the phone's own saved ticket opens.
    expect(savedTicket(null, "t1").secret).toBe(SECRET);
    // Saving for another account replaces what was here.
    saveTicketList("u2", [ticket("t9")]);
    expect(savedTicket(null, "t1")).toBeNull();
  });

  it("is cleared on log out", () => {
    saveTicket("u1", "t1", { secret: SECRET });
    clearSavedTickets();
    expect(hasSavedTickets()).toBe(false);
  });
});

describe("the phone's own code", () => {
  it("matches the server's TOTP (RFC 6238 test vectors, what pyotp produces)", async () => {
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    expect(await computeTotp(rfcSecret, 59)).toBe("287082");
    expect(await computeTotp(rfcSecret, 1111111109)).toBe("081804");
    expect(await computeTotp(rfcSecret, 1234567890)).toBe("005924");
  });

  describe("with no network", () => {
    let realFetch;
    beforeEach(async () => {
      realFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() => { throw new Error("NETWORK CALL ATTEMPTED"); });
      await wipeAll();
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it("is accepted by an offline gate scanner, and changes each window", async () => {
      // While online: the list loaded and the secret was saved.
      saveTicketList("u1", [ticket("t1")]);
      saveTicket("u1", "t1", { secret: SECRET });
      // The gate synced the same ticket earlier.
      await replaceCredentials([{ id: "t1", tier_name: "General", seat_number: null, gate_assignment: null, totp_secret: SECRET, status: "active" }]);

      // Offline, session expired: the phone reads its saved secret and makes the code.
      const saved = savedTicket(null, "t1");
      const now = Math.floor(Date.now() / 1000);
      const payload = `TIKETI:t1:${await computeTotp(saved.secret, now)}`;

      const verdict = await validate(payload, { gateName: "Gate A" });
      expect(verdict.reasonCode ?? verdict.reason).toBe(REASON.GRANTED);

      // Two windows later the old code is refused: a screenshot doesn't work.
      const stale = `TIKETI:t1:${await computeTotp(saved.secret, now - 90)}`;
      await wipeAll();
      await replaceCredentials([{ id: "t1", tier_name: "General", seat_number: null, gate_assignment: null, totp_secret: SECRET, status: "active" }]);
      const staleVerdict = await validate(stale, { gateName: "Gate A" });
      expect(staleVerdict.reasonCode ?? staleVerdict.reason).toBe(REASON.BAD_OTP);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
