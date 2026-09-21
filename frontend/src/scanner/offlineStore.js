// The Scanner PWA's local, on-device cache — spec.md §6: "gate staff validate
// fully offline after a pre-event sync". After syncGateData() runs once
// (src/mock/mockApi.js — the one real network call in the whole flow), every
// scan below is decided entirely from this localStorage-held snapshot via the
// same pure decideScan() the mock "server" itself uses (src/mock/scanValidation.js)
// — no further api.* calls happen until the gate staff chooses to upload.
import { parseScanPayload, decideScan } from "../mock/scanValidation";

const KEY = "tiketi_scanner_session";

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function newSessionFromSync(eventId, gateId, sync) {
  return {
    eventId,
    gateId,
    scannerId: sync.scanner_id,
    eventTitle: sync.event_title,
    gateName: sync.gate_name,
    eventDate: sync.event_date,
    endsAt: sync.ends_at,
    syncedAt: sync.synced_at,
    totalCached: sync.total_count,
    tickets: Object.fromEntries(sync.tickets.map((t) => [t.id, t])),
    pending: [],
    log: [],
    scannedTotal: 0,
    admittedTotal: 0,
    deniedTotal: 0,
    uploadedCount: 0,
  };
}

export function estimatedStorageKb(session) {
  return Math.max(1, Math.round(JSON.stringify(session.tickets).length / 1024));
}

/** Pure-ish: mutates and returns the ticket cache + queues, doesn't touch localStorage itself. */
export function scanOffline(session, rawPayload) {
  const scannedAt = new Date().toISOString();
  const parsed = parseScanPayload(rawPayload);

  let ticket = null;
  let decision;
  if (!parsed) {
    decision = { granted: false, reason: "Invalid QR format" };
  } else {
    ticket = session.tickets[parsed.ticketId];
    decision = decideScan({ ticket, otp: parsed.otp, gateName: session.gateName });
  }

  const entry = {
    ticket_id: parsed?.ticketId || null,
    tier_name: ticket?.tier_name || null,
    result: decision.granted ? "granted" : "denied",
    reason: decision.reason || null,
    scanned_at: scannedAt,
  };

  if (decision.granted && ticket) {
    session.tickets[parsed.ticketId] = { ...ticket, status: "used", used_at: scannedAt };
  }
  session.pending = [...session.pending, entry];
  session.log = [entry, ...session.log].slice(0, 12);
  session.scannedTotal += 1;
  if (decision.granted) session.admittedTotal += 1;
  else session.deniedTotal += 1;

  return { session, entry, granted: decision.granted, reason: decision.reason, tierName: ticket?.tier_name };
}

export function markUploaded(session) {
  session.uploadedCount += session.pending.length;
  session.pending = [];
  return session;
}
