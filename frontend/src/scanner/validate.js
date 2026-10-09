// THE OFFLINE VALIDATION PATH (Work Order 03, A5).
//
// No network call may occur anywhere in this file. Not a fetch, not an
// XMLHttpRequest, not navigator.sendBeacon, not a WebSocket message, not an
// "if online, double check with the server" branch. That branch is the
// single easiest way to quietly destroy this project's central contribution
// — see validate.offline.test.js, which asserts none of those primitives
// are ever invoked while this function runs, across 100+ validations.
//
// This module only reads from credentialStore.js (local IndexedDB, already
// populated by a sync that happened earlier) and does pure math via
// totp.js (Web Crypto, also local). Pulling credentials in and uploading
// scan results out both use the network — deliberately kept in separate
// files/call sites so that boundary is visible in the file structure, not
// just stated in a comment.

import { verifyTotp } from "./totp";
import { getCredential, getAdmission, recordAdmission } from "./credentialStore";

export const REASON = {
  GRANTED: "GRANTED",
  INVALID_FORMAT: "INVALID_FORMAT",
  UNKNOWN_TICKET: "UNKNOWN_TICKET",
  BAD_OTP: "BAD_OTP",
  ALREADY_ADMITTED: "ALREADY_ADMITTED",
  WRONG_GATE: "WRONG_GATE",
};

const DISPLAY_REASON = {
  [REASON.INVALID_FORMAT]: "Invalid QR format",
  [REASON.UNKNOWN_TICKET]: "Ticket not found",
  [REASON.BAD_OTP]: "Credential expired or invalid",
};

/** Same wire format as the real backend (app/services/totp_service.py) and
 * the mock: "TIKETI:<ticket_id>:<otp>". Independent re-implementation, not
 * imported from src/mock/ — this path must never depend on the mock's fake
 * OTP math. */
export function parsePayload(raw) {
  const parts = String(raw ?? "").trim().split(":");
  if (parts.length !== 3 || parts[0] !== "TIKETI") return null;
  const [, ticketId, otp] = parts;
  if (!ticketId || !otp) return null;
  return { ticketId, otp };
}

/**
 * The one exported decision function. Four checks, failing fast, in order:
 *   1. format & integrity   2. TOTP window   3. prior admission   4. gate assignment
 *
 * Returns a structured verdict with a machine-readable reasonCode (see
 * REASON above) — these become the evaluation categories in Block B's
 * measurement harness, not just UI copy.
 */
export async function validate(rawPayload, { gateName } = {}) {
  // 1. Format and integrity. A ticket id not present in this device's
  // synced credential set also means "doesn't belong to this event" —
  // sync only ever returns this event's own active tickets, so there is
  // no separate "right event" check beyond "do we have it locally."
  const parsed = parsePayload(rawPayload);
  if (!parsed) {
    return { granted: false, reasonCode: REASON.INVALID_FORMAT, reason: DISPLAY_REASON[REASON.INVALID_FORMAT] };
  }

  const credential = await getCredential(parsed.ticketId);
  if (!credential) {
    return {
      granted: false,
      reasonCode: REASON.UNKNOWN_TICKET,
      reason: DISPLAY_REASON[REASON.UNKNOWN_TICKET],
      ticketId: parsed.ticketId,
    };
  }

  // 2. TOTP window.
  const otpValid = await verifyTotp(credential.totp_secret, parsed.otp);
  if (!otpValid) {
    return {
      granted: false,
      reasonCode: REASON.BAD_OTP,
      reason: DISPLAY_REASON[REASON.BAD_OTP],
      ticketId: parsed.ticketId,
    };
  }

  // 3. Prior admission — this device's own local record, not the synced
  // `status` snapshot from sync time.
  const existingAdmission = await getAdmission(parsed.ticketId);
  if (existingAdmission) {
    const at = new Date(existingAdmission.scanned_at).toLocaleTimeString("en-KE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      granted: false,
      reasonCode: REASON.ALREADY_ADMITTED,
      reason: `Already admitted at ${at}`,
      ticketId: parsed.ticketId,
    };
  }

  // 4. Gate assignment. credential.gate_assignment is always null today —
  // no per-ticket assignment exists in the real schema yet (see
  // docs/offline-validation.md) — so this check currently always passes.
  // Wired now so it activates for free once that data exists.
  if (gateName && credential.gate_assignment && credential.gate_assignment !== gateName) {
    return {
      granted: false,
      reasonCode: REASON.WRONG_GATE,
      reason: `Wrong gate — this ticket is for ${credential.gate_assignment}`,
      ticketId: parsed.ticketId,
    };
  }

  // Granted. Write the admission BEFORE returning, so a double-scan a
  // second later is caught even if the UI never gets to re-render first.
  const scannedAt = new Date().toISOString();
  await recordAdmission(parsed.ticketId, scannedAt);

  return {
    granted: true,
    reasonCode: REASON.GRANTED,
    ticketId: parsed.ticketId,
    tierName: credential.tier_name,
    seatNumber: credential.seat_number,
    scannedAt,
  };
}
