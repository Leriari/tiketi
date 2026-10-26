// Real backend implementation — talks to the FastAPI app. This is what
// src/api.js switches to once VITE_USE_MOCK=false. Built and verified working
// against the live backend on 2026-09-13 (see the ChainTix roadmap plan) —
// UI work between now and re-enabling it should keep this file's shape in
// sync with src/mock/mockApi.js so the swap stays a one-line change.
import { ApiError } from "../errors";
import { getToken, clearToken } from "../auth-storage";
import { getDeviceToken } from "../scanner/deviceAuth";
import { getActiveOrgId } from "../activeOrg";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

async function _send(path, { method, body, headers }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only rejects when no response arrived at all — the server is
    // down or unreachable, not that the request was refused.
    throw new ApiError(`Can't reach the TiketiKE server at ${BASE_URL}. Is the backend running?`, 0);
  }

  if (res.status === 204) return null;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    let message = (isJson && (data.detail || data.message)) || `Request failed (${res.status})`;
    if (Array.isArray(message)) {
      // FastAPI validation errors: [{loc, msg}, ...] — show the sentences.
      message = message.map((d) => (d.msg || "").replace(/^Value error, /, "")).filter(Boolean).join(" ") || "Some fields are invalid.";
    }
    throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status);
  }

  return data;
}

// Work Order 05 A4 — a 401 on an authenticated user request means the
// session is gone (expired/invalid token), not that this one call failed.
// Handled here, once, rather than in every page that calls request(): clear
// the stale token and send the user to /login with their place in the app
// preserved, instead of a page showing a confusing raw error (or several,
// if more than one request was in flight). A fresh login attempt (and
// /dev/otp-inbox, auth:false calls) must never trigger this — only an
// *authenticated* call going suddenly unauthenticated means the session
// expired.
function handleExpiredSession() {
  clearToken();
  localStorage.removeItem("tiketi_user");
  if (!window.location.pathname.startsWith("/login")) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?return=${returnTo}`;
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  let hadToken = false;
  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      hadToken = true;
    }
  }
  try {
    return await _send(path, { method, body, headers });
  } catch (err) {
    if (hadToken && err instanceof ApiError && err.status === 401) {
      handleExpiredSession();
    }
    throw err;
  }
}

// A gate device authenticates with its own long-lived device token, never
// a user JWT (Work Order 04 B4) — a steward shouldn't need to be a user
// account, and a phone at a gate shouldn't carry credentials that work
// anywhere else. Used only by syncGateData below.
async function deviceRequest(path, { method = "GET", body } = {}) {
  const token = getDeviceToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return _send(path, { method, body, headers });
}

// Organiser Console calls are scoped to the active organisation
// (activeOrg.js, kept in sync by AuthContext).
function orgRequest(suffix, opts) {
  const orgId = getActiveOrgId();
  if (!orgId) {
    return Promise.reject(new ApiError("You don't belong to an organisation yet.", 403));
  }
  return request(`/organisations/${orgId}${suffix}`, opts);
}

function query(params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const str = qs.toString();
  return str ? `?${str}` : "";
}

// Fetch an authenticated file (CSV export, sales statement) and hand it to
// the browser as a download. A plain <a href> can't send the bearer token.
async function downloadFile(path, fallbackName) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(`Can't reach the TiketiKE server at ${BASE_URL}. Is the backend running?`, 0);
  }
  if (!res.ok) {
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const detail = isJson ? (await res.json()).detail : null;
    throw new ApiError(typeof detail === "string" ? detail : `Download failed (${res.status})`, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { success: true };
}

// Returns a *rejected promise*, never throws synchronously: every page
// fetches through useApiData's `fetcher().then().catch()`, and a synchronous
// throw escapes that chain, crashes the render tree, and leaves a blank
// white page instead of the page's own error state with a Retry button.
function notImplemented(name) {
  return () =>
    Promise.reject(
      new ApiError(`This isn't connected to the real backend yet (${name} has no endpoint).`, 501)
    );
}

export const liveApi = {
  health: () => fetch(`${BASE_URL.replace(/\/api\/v1$/, "")}/`).then((r) => r.json()),

  // DEV/TEST ONLY — the backend 404s this outside APP_ENV=development
  // (Work Order 05 A1). Kept only so nothing importing it directly breaks;
  // the real app calls requestOtp/verifyOtp below via Login.jsx.
  login: (phone_number) => request("/auth/login", { method: "POST", body: { phone_number }, auth: false }),
  requestOtp: (phone_number) => request("/auth/request-otp", { method: "POST", body: { phone_number }, auth: false }),
  verifyOtp: (phone_number, otp_code, googleLinkToken) =>
    request("/auth/verify-otp", {
      method: "POST",
      body: { phone_number, otp_code, ...(googleLinkToken ? { google_link_token: googleLinkToken } : {}) },
      auth: false,
    }),
  // Exchanges a Firebase ID token (phone or Google sign-in) for a session.
  // A Google account not linked to a phone yet returns
  // { needs_phone, link_token, email } instead; the follow-up phone sign-in
  // passes googleLinkToken to link the two.
  // First Google sign-in on a deployment with no SMS: record the phone
  // number (unverified) and create the account.
  googlePhone: (linkToken, phoneNumber) =>
    request("/auth/google-phone", { method: "POST", body: { link_token: linkToken, phone_number: phoneNumber }, auth: false }),
  firebaseLogin: (idToken, googleLinkToken) =>
    request("/auth/firebase", {
      method: "POST",
      body: { id_token: idToken, ...(googleLinkToken ? { google_link_token: googleLinkToken } : {}) },
      auth: false,
    }),
  me: () => request("/auth/me"),
  // Work Order 04 C1 — AuthContext fetches this right after login to know
  // which organisations (and at which role) this user can manage.
  getMyOrganisations: () => request("/organisations/mine"),

  // The signed-in user's own account (app/api/routes/me.py).
  getProfile: () => request("/me/profile"),
  // Either or both: { displayName, email }.
  updateProfile: ({ displayName, email }) =>
    request("/me/profile", { method: "PATCH", body: { display_name: displayName, email } }),
  getActivity: ({ before, category, limit } = {}) => request(`/me/activity${query({ before, category, limit })}`),
  // Ends every other session; returns a fresh token for this device.
  signOutEverywhere: () => request("/me/sign-out-everywhere", { method: "POST" }),

  listEvents: () => request("/events/"),
  getEvent: (id) => request(`/events/${id}`),
  // The Event Management form's payload, created under the active organisation.
  createEvent: (payload) => request("/events/", { method: "POST", body: { ...payload, organization_id: getActiveOrgId() } }),
  updateEvent: (eventId, payload) => request(`/events/${eventId}`, { method: "PATCH", body: payload }),

  purchaseTicket: (payload) => request("/payments/purchase", { method: "POST", body: payload }),
  getPaymentStatus: (paymentId) => request(`/payments/${paymentId}/status`),
  devConfirmPayment: (paymentId) => request(`/payments/${paymentId}/dev-confirm`, { method: "POST" }),

  myTickets: () => request("/tickets/my"),
  getTicketSeed: (ticketId) => request(`/tickets/${ticketId}/seed`),

  // The QR endpoint requires auth, and a plain <img src> can't send an
  // Authorization header — so we fetch it as a blob and hand back an object
  // URL the caller can point an <img> at directly.
  getTicketQrBlob: async (ticketId) => {
    const token = getToken();
    const res = await fetch(`${BASE_URL}/tickets/${ticketId}/qr.png`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError("Could not load QR code", res.status);
    const blob = await res.blob();
    const expiresIn = Number(res.headers.get("X-QR-Expires-In") || 30);
    return { url: URL.createObjectURL(blob), expiresIn };
  },

  // Live QR Scanner in the Organiser Console: staff-only, checked against this event, recorded as attendance.
  scanAtEvent: (eventId, qrPayload) => orgRequest(`/events/${eventId}/scan`, { method: "POST", body: { qr_payload: qrPayload } }),

  // UI-only features with no backend yet — see mock/mockApi.js for what
  // they'll eventually need to do.
  getOrganiserDashboard: notImplemented("getOrganiserDashboard"),
  getTicketDetail: (ticketId) => request(`/tickets/${ticketId}/detail`),
  // Reads the ticket back from the contract and checks it against ChainTix's records.
  verifyTicketOnchain: (ticketId) => request(`/tickets/${ticketId}/onchain`),
  transferTicket: (ticketId, { recipient }) =>
    request(`/tickets/${ticketId}/transfer`, { method: "POST", body: { recipient } }),
  resendReceipt: (ticketId) => request(`/tickets/${ticketId}/receipt`, { method: "POST" }),
  claimTicketToWallet: notImplemented("claimTicketToWallet"),

  // Seller Portal (spec.md §4) — wired to the real resale backend
  // (Work Order 02). getOrganiserDashboard/getTicketDetail/transferTicket/
  // claimTicketToWallet above stay stubs — out of this work order's scope.
  getEligibleTickets: () => request("/resale/eligible-tickets"),
  sellTicket: (ticketId, { price }) =>
    request("/resale/listings", { method: "POST", body: { ticket_id: ticketId, price_kes: price } })
      .then((listing) => ({ listing_id: listing.id, status: listing.status })),
  getSellerDashboard: () => request("/resale/dashboard"),
  getMyListings: () => request("/resale/my-listings"),
  repriceListing: (listingId, { price }) =>
    request(`/resale/listings/${listingId}/reprice`, { method: "POST", body: { price_kes: price } }),
  pauseListing: (listingId) => request(`/resale/listings/${listingId}/pause`, { method: "POST" }),
  cancelListing: (listingId) => request(`/resale/listings/${listingId}`, { method: "DELETE" }),
  getWallet: () => request("/resale/wallet"),
  withdrawToMpesa: ({ amount, phoneNumber }) =>
    request("/resale/withdraw", { method: "POST", body: { amount_kes: amount, phone_number: phoneNumber } }),
  getDisputes: () => request("/resale/disputes"),

  // Resale marketplace — buyer side.
  getResaleListings: ({ eventId, sort } = {}) => request(`/resale/listings${query({ event_id: eventId, sort })}`, { auth: false }),
  getResaleListing: (listingId) => request(`/resale/listings/${listingId}`, { auth: false }),
  buyResaleListing: (listingId, { phoneNumber }) =>
    request(`/resale/listings/${listingId}/buy`, { method: "POST", body: { phone_number: phoneNumber } }),
  // awaiting_payment -> transferring -> complete (or failed / delayed)
  getResalePurchase: (paymentId) => request(`/resale/purchases/${paymentId}`),

  // Organiser Console (spec.md §5) — app/api/routes/organiser_console.py,
  // every call scoped to the active organisation.
  getOrganiserProfile: () => orgRequest("/profile"),
  updateOrganiserProfile: ({ businessName, kraPin, contactEmail, contactPhone }) =>
    orgRequest("/profile", { method: "PATCH", body: { businessName, kraPin, contactEmail, contactPhone: contactPhone || null } }),
  getPayoutDetails: () => orgRequest("/payout-details"),
  updatePayoutDetails: ({ payoutMethod, payoutDestination }) =>
    orgRequest("/payout-details", { method: "PATCH", body: { payoutMethod, payoutDestination } }),

  getTeamMembers: () =>
    orgRequest("/members").then((rows) =>
      rows.map((m) => ({
        id: m.id,
        name: m.display_name || "—",
        phone: m.phone_number,
        role: m.role,
        // Membership takes effect immediately; there's no accept step.
        status: "active",
        invited_at: m.created_at,
      }))
    ),
  inviteTeamMember: ({ name, phone, role }) =>
    orgRequest("/members", { method: "POST", body: { phone_number: phone, role, name } }),
  updateTeamMemberRole: (memberId, role) => orgRequest(`/members/${memberId}`, { method: "PATCH", body: { role } }),
  removeTeamMember: (memberId) => orgRequest(`/members/${memberId}`, { method: "DELETE" }),

  getControlCenter: () => orgRequest("/control-center"),
  sendComplimentaryTicket: ({ eventId, tierId, recipientName, recipientPhone, note }) =>
    orgRequest("/complimentary-tickets", {
      method: "POST",
      body: { event_id: eventId, tier_id: tierId || null, recipient_name: recipientName, recipient_phone: recipientPhone, note: note || null },
    }),
  getGuestLists: () => orgRequest("/guest-lists"),
  getAttendanceSummary: () => orgRequest("/attendance"),
  getRevenueBreakdown: () => orgRequest("/revenue-breakdown"),
  // No traffic/referrer tracking exists, so there is nothing real to show.
  getMarketingAnalytics: () => Promise.resolve({ trackingEnabled: false, sources: [], campaigns: [] }),
  getExports: () => orgRequest("/exports"),
  requestExport: ({ type, format }) => orgRequest("/exports", { method: "POST", body: { type, format } }),
  downloadExport: (exportId) => downloadFile(`/organisations/${getActiveOrgId()}/exports/${exportId}/download`, "export.csv"),
  getReports: () => orgRequest("/reports"),
  downloadReport: (eventId) => downloadFile(`/organisations/${getActiveOrgId()}/reports/${eventId}/download`, "sales-statement.csv"),
  getEarnings: () => orgRequest("/earnings"),

  getOrganiserEvents: () => orgRequest("/events"),
  getOrganiserEvent: (eventId) => orgRequest(`/events/${eventId}`),
  getTicketCentral: ({ eventId, status, query: q } = {}) =>
    orgRequest(`/tickets${query({ event_id: eventId, status_filter: status, query: q })}`),
  auditLookup: (q) => orgRequest(`/audit-lookup${query({ q })}`),
  getCrowdControl: (eventId) => orgRequest(`/events/${eventId}/crowd-control`),
  submitManualOverride: ({ eventId, ticketId, reason }) =>
    orgRequest(`/events/${eventId}/manual-override`, { method: "POST", body: { ticket_id: ticketId, reason } }),

  getScannerDevices: () => orgRequest("/scanners"),
  // Registers a device slot for one event + gate. Returns the one-time
  // enrolment code the gate phone types into /scanner.
  inviteScanner: ({ eventId, gateName, deviceName }) =>
    request("/gate/scanners", { method: "POST", body: { event_id: eventId, gate_name: gateName, label: deviceName } }),
  revokeScanner: (scannerId) => request(`/gate/scanners/${scannerId}/revoke`, { method: "POST" }),

  getContractStatus: (eventId) => orgRequest(`/events/${eventId}/contract-status`),
  getRoyaltyLedger: () => orgRequest("/royalty-ledger"),
  getResaleCompliance: () => orgRequest("/resale-compliance"),

  // Scanner PWA (spec.md §6 / Work Order 03, re-authenticated in Work
  // Order 04 B4/C3) — syncGateData is real: it's the one network call the
  // whole offline-validation design allows (pulls credentials in, before
  // doors open). Authenticates with the device's own long-lived token
  // (deviceRequest), not the logged-in user's JWT — a device enrols once
  // via enrollScanner, and the event/gate it's scoped to come from that
  // enrolment response (src/scanner/deviceAuth.js), not a parameter
  // chosen here. reportScanBatch uploads admissions back once online.
  syncGateData: ({ eventId }) => deviceRequest(`/gate/sync-event/${eventId}`),
  enrollScanner: ({ enrollmentCode, deviceId }) =>
    request("/gate/enroll", {
      method: "POST",
      body: { enrollment_code: enrollmentCode, device_id: deviceId },
      auth: false,
    }),
  // Uploads offline admissions (Work Order 05 B5). The Scanner only keeps
  // admitted scans locally, so each one is sent as granted.
  reportScanBatch: ({ scans }) =>
    deviceRequest("/gate/scan-upload", {
      method: "POST",
      body: {
        scans: scans.map((sc) => ({
          ticket_id: sc.ticket_id,
          granted: sc.result ? sc.result === "granted" : true,
          reason_code: sc.reason || "GRANTED",
          scanned_at: sc.scanned_at,
        })),
      },
    }),

  // Platform Admin (spec.md §7) — app/api/routes/admin.py.
  getPlatformDashboard: () => request("/admin/dashboard"),
  getPlatformOrganisers: () => request("/admin/organisers"),
  reviewOrganiser: ({ id, decision, reason }) =>
    request(`/admin/organisers/${id}/review`, { method: "POST", body: { decision, reason } }),
  suspendOrganiser: ({ id, reason }) => request(`/admin/organisers/${id}/suspend`, { method: "POST", body: { reason } }),
  reinstateOrganiser: (id) => request(`/admin/organisers/${id}/reinstate`, { method: "POST" }),
  getEventApprovalQueue: () => request("/admin/event-approvals"),
  approveEvent: (eventId) => request(`/admin/events/${eventId}/approve`, { method: "POST" }),
  rejectEvent: ({ eventId, reason }) => request(`/admin/events/${eventId}/reject`, { method: "POST", body: { reason } }),
  getPlatformCosts: () => request("/admin/costs"),
  getFeeConfig: () => request("/admin/fees"),
  updateFeeConfig: (payload) => request("/admin/fees", { method: "PUT", body: payload }),
  getPayoutQueue: () => request("/admin/payouts"),
  getPlatformResaleCompliance: () => request("/admin/resale-compliance"),
  getFraudSignals: () => request("/admin/fraud-signals"),
  getBroadcastChannels: () => request("/admin/broadcast-channels"),
  getBroadcasts: () => request("/admin/broadcasts"),
  sendBroadcast: (payload) => request("/admin/broadcasts", { method: "POST", body: payload }),
  getAnnouncements: () => request("/announcements"),
  getAuditLog: ({ query: q } = {}) => request(`/admin/audit-log${query({ q })}`),
  exportAuditLog: ({ query: q } = {}) => downloadFile(`/admin/audit-log/export${query({ q })}`, "audit-log.csv"),
  getAdminUsers: () => request("/admin/admins"),
  inviteAdminUser: (payload) => request("/admin/admins", { method: "POST", body: payload }),
  removeAdminUser: (id) => request(`/admin/admins/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getAdminNotifications: () => request("/admin/notifications"),
  getFeatureFlags: () => request("/admin/feature-flags"),
  toggleFeatureFlag: (id) => request(`/admin/feature-flags/${id}/toggle`, { method: "POST" }),
  updateFeatureFlagRollout: ({ id, rolloutPercent }) =>
    request(`/admin/feature-flags/${id}/rollout`, { method: "PUT", body: { rollout_percent: rolloutPercent } }),
};
