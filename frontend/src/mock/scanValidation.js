// Shared between mockApi.js (server-side scans, e.g. Organiser's Live QR
// Scanner) and the Scanner PWA's fully offline validator — same algorithm
// runs in both places so the two paths can never disagree. This is the mock
// stand-in for the report's client-side HMAC-SHA1 TOTP check (Phase 5);
// deterministic hash + a shared time window plays the same role here.
const ROTATION_S = 30;

export { ROTATION_S };

export function mockOtp(ticketId) {
  const w = Math.floor(Date.now() / (ROTATION_S * 1000));
  const s = `${ticketId}:${w}`;
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) >>> 0;
  return String(hash % 1000000).padStart(6, "0");
}

export function buildPayload(ticketId) {
  return `TIKETI:${ticketId}:${mockOtp(ticketId)}`;
}

export function secondsUntilRotation() {
  return ROTATION_S - (Math.floor(Date.now() / 1000) % ROTATION_S);
}

export function parseScanPayload(raw) {
  const parts = String(raw || "").trim().split(":");
  if (parts.length !== 3 || parts[0] !== "TIKETI") return null;
  return { ticketId: parts[1], otp: parts[2] };
}

/**
 * Pure decision function — no I/O, no mutation. `ticket` is a plain object
 * with at least { id, status, used_at, gate_assignment }; it can come from
 * the mock "server" db or a device's offline cache and this returns the same
 * answer either way.
 */
export function decideScan({ ticket, otp, gateName }) {
  if (!ticket) return { granted: false, reason: "Ticket not found" };
  if (otp !== mockOtp(ticket.id)) return { granted: false, reason: "Credential expired" };
  if (ticket.status === "used") {
    const at = ticket.used_at
      ? new Date(ticket.used_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
      : null;
    return { granted: false, reason: at ? `Already admitted at ${at}` : "Already admitted" };
  }
  if (ticket.status !== "active") return { granted: false, reason: `Ticket status: ${ticket.status}` };
  if (gateName && ticket.gate_assignment && ticket.gate_assignment !== gateName) {
    return { granted: false, reason: `Wrong gate — this ticket is for ${ticket.gate_assignment}` };
  }
  return { granted: true };
}
