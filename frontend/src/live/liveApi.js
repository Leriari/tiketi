// Real backend implementation — talks to the FastAPI app. This is what
// src/api.js switches to once VITE_USE_MOCK=false. Built and verified working
// against the live backend on 2026-09-13 (see the ChainTix roadmap plan) —
// UI work between now and re-enabling it should keep this file's shape in
// sync with src/mock/mockApi.js so the swap stays a one-line change.
import { ApiError } from "../errors";
import { getToken } from "../auth-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (isJson && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status);
  }

  return data;
}

function notImplemented(name) {
  return () => {
    throw new ApiError(
      `${name} has no backend endpoint yet — it's a Phase 6 (resale marketplace) / dashboard feature still UI-only.`,
      501
    );
  };
}

export const liveApi = {
  health: () => fetch(`${BASE_URL.replace(/\/api\/v1$/, "")}/`).then((r) => r.json()),

  login: (phone_number) => request("/auth/login", { method: "POST", body: { phone_number }, auth: false }),
  me: () => request("/auth/me"),

  listEvents: () => request("/events/"),
  getEvent: (id) => request(`/events/${id}`),
  // NOTE: the mock's createEvent payload (tiers[], image_data_url, resale window,
  // gates[]) has outgrown the real backend's flat EventCreate schema since the
  // Organiser Console was built — reconciling that is Phase 3 backend work, not
  // done here. This call will need a payload-shape adapter before it works live.
  createEvent: (payload) => request("/events/", { method: "POST", body: payload }),

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

  scanTicket: (payload) => request("/gate/scan", { method: "POST", body: payload, auth: false }),

  // UI-only features with no backend yet — see mock/mockApi.js for what
  // they'll eventually need to do.
  getOrganiserDashboard: notImplemented("getOrganiserDashboard"),
  getTicketDetail: notImplemented("getTicketDetail"),
  transferTicket: notImplemented("transferTicket"),
  claimTicketToWallet: notImplemented("claimTicketToWallet"),

  // Seller Portal (spec.md §4) — Phase 6 resale marketplace, no backend yet.
  getEligibleTickets: notImplemented("getEligibleTickets"),
  sellTicket: notImplemented("sellTicket"),
  getSellerDashboard: notImplemented("getSellerDashboard"),
  getMyListings: notImplemented("getMyListings"),
  repriceListing: notImplemented("repriceListing"),
  pauseListing: notImplemented("pauseListing"),
  cancelListing: notImplemented("cancelListing"),
  getWallet: notImplemented("getWallet"),
  withdrawToMpesa: notImplemented("withdrawToMpesa"),
  getDisputes: notImplemented("getDisputes"),

  // Organiser Console (spec.md §5) — no backend yet.
  getOrganiserProfile: notImplemented("getOrganiserProfile"),
  updateOrganiserProfile: notImplemented("updateOrganiserProfile"),
  getPayoutDetails: notImplemented("getPayoutDetails"),
  updatePayoutDetails: notImplemented("updatePayoutDetails"),
  getTeamMembers: notImplemented("getTeamMembers"),
  inviteTeamMember: notImplemented("inviteTeamMember"),
  removeTeamMember: notImplemented("removeTeamMember"),
  getControlCenter: notImplemented("getControlCenter"),
  sendComplimentaryTicket: notImplemented("sendComplimentaryTicket"),
  getGuestLists: notImplemented("getGuestLists"),
  getAttendanceSummary: notImplemented("getAttendanceSummary"),
  getRevenueBreakdown: notImplemented("getRevenueBreakdown"),
  getMarketingAnalytics: notImplemented("getMarketingAnalytics"),
  getExports: notImplemented("getExports"),
  requestExport: notImplemented("requestExport"),
  getReports: notImplemented("getReports"),
  getEarnings: notImplemented("getEarnings"),
  getOrganiserEvents: notImplemented("getOrganiserEvents"),
  getOrganiserEvent: notImplemented("getOrganiserEvent"),
  updateEvent: notImplemented("updateEvent"),
  getTicketCentral: notImplemented("getTicketCentral"),
  auditLookup: notImplemented("auditLookup"),
  getCrowdControl: notImplemented("getCrowdControl"),
  submitManualOverride: notImplemented("submitManualOverride"),
  getScannerDevices: notImplemented("getScannerDevices"),
  inviteScanner: notImplemented("inviteScanner"),
  revokeScanner: notImplemented("revokeScanner"),
  getContractStatus: notImplemented("getContractStatus"),
  getRoyaltyLedger: notImplemented("getRoyaltyLedger"),
  getResaleCompliance: notImplemented("getResaleCompliance"),

  // Scanner PWA (spec.md §6) — offline gate validation needs a real pre-event
  // sync/reconciliation pair on the backend; doesn't exist yet.
  syncGateData: notImplemented("syncGateData"),
  reportScanBatch: notImplemented("reportScanBatch"),

  // Platform Admin (spec.md §7) — no backend yet; needs a real multi-tenant
  // organizer-account model and an admin-role concept, both Phase 3+ work.
  getPlatformDashboard: notImplemented("getPlatformDashboard"),
  getPlatformOrganisers: notImplemented("getPlatformOrganisers"),
  reviewOrganiser: notImplemented("reviewOrganiser"),
  suspendOrganiser: notImplemented("suspendOrganiser"),
  reinstateOrganiser: notImplemented("reinstateOrganiser"),
  getEventApprovalQueue: notImplemented("getEventApprovalQueue"),
  approveEvent: notImplemented("approveEvent"),
  rejectEvent: notImplemented("rejectEvent"),
  getPlatformCosts: notImplemented("getPlatformCosts"),
  getFeeConfig: notImplemented("getFeeConfig"),
  updateFeeConfig: notImplemented("updateFeeConfig"),
  getPayoutQueue: notImplemented("getPayoutQueue"),
  getPlatformResaleCompliance: notImplemented("getPlatformResaleCompliance"),
  getFraudSignals: notImplemented("getFraudSignals"),
  getBroadcasts: notImplemented("getBroadcasts"),
  sendBroadcast: notImplemented("sendBroadcast"),
  getAuditLog: notImplemented("getAuditLog"),
  getAdminUsers: notImplemented("getAdminUsers"),
  inviteAdminUser: notImplemented("inviteAdminUser"),
  removeAdminUser: notImplemented("removeAdminUser"),
  getAdminNotifications: notImplemented("getAdminNotifications"),
  getFeatureFlags: notImplemented("getFeatureFlags"),
  toggleFeatureFlag: notImplemented("toggleFeatureFlag"),
  updateFeatureFlagRollout: notImplemented("updateFeatureFlagRollout"),
};
