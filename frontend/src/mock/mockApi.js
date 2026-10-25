// In-browser mock backend. Same call shape as live/liveApi.js — src/api.js
// swaps between them with one flag. Purpose: build and review the entire UI
// today without a running FastAPI server; every function here mirrors what
// the real endpoint already does (or, for the two flagged "mock-only"
// features, what a Phase 6 endpoint will need to do once it exists).
//
// State lives in localStorage under DB_KEY so a page refresh doesn't reset a
// demo mid-flow. Clear it from devtools (or call resetMockDb()) to start over.
import QRCode from "qrcode";
import { ApiError } from "../errors";
import { getToken, setToken } from "../auth-storage";
import { seedEvents } from "./seed";
import { mockOtp, buildPayload, secondsUntilRotation, parseScanPayload, decideScan } from "./scanValidation";

const DB_KEY = "tiketi_mock_db";
const PAYMENT_DELAY_MS = 4500; // simulated time for the user to approve the M-Pesa prompt

const uuid = () => crypto.randomUUID();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Store ──────────────────────────────────────────────────────────────────

function freshDb() {
  return {
    events: seedEvents.map((e) => ({
      ...e,
      status: "live", // draft|live|paused|sold_out|cancelled — spec §5.2
      created_at: new Date().toISOString(),
      resale: {
        ...e.resale,
        resaleEnabled: e.resale.resaleEnabled ?? true,
        windowOpenDays: 0, // resale opens immediately after purchase, by default
        windowCloseHours: 2, // resale closes 2h before the event, by default
      },
      gates: [{ id: uuid(), name: "Gate A" }],
      tiers: e.tiers.map((t) => ({
        ...t,
        tickets_sold: 0,
        description: "",
        salesStart: null,
        salesEnd: null,
        perOrderMax: 4,
        visibility: "public", // public|hidden|password
      })),
    })),
    users: {}, // phone -> { id, phone_number }
    tickets: [], // see shape notes below
    payments: [],
    listings: [], // Seller Portal — see sellTicket() for shape
    walletTransactions: [], // Seller Portal wallet ledger (per-seller)
    disputes: [], // Seller Portal dispute centre — empty by default, no seed drama

    // Organiser Console — everything below is a platform-wide singleton, not
    // per-user. There's no real multi-tenant organizer-account model yet on
    // either the mock or the real backend (that's Phase 3 territory) — this
    // console manages the whole demo platform's events rather than a scoped
    // subset, which is the honest thing to build against today's data model.
    organiserWalletTransactions: [], // primary-sale + royalty income ledger
    admissions: [], // every gate-scan attempt, granted or denied
    gateScanners: [], // registered scanner devices (QR Scanner Hub)
    rejectedListingAttempts: [], // above-cap resale attempts (Resale Compliance)
    auditLog: [], // manual overrides and other organiser actions
    teamMembers: [],
    organiserProfile: { businessName: "", kraPin: "", contactEmail: "", contactPhone: "", payoutMethod: "mpesa", payoutDestination: "" },
    exportsRequested: [],

    // Platform Admin (spec.md §7) — ChainTix staff, not an organiser or
    // attendee. Same "no multi-tenant model yet" reality as Organiser Console
    // above, but here it's the correct shape rather than a simplification:
    // Admin is *supposed* to see every organiser/event on the platform.
    platformOrganisers: [
      { id: "org-nairobi-live", business_name: "Nairobi Live Events Ltd", kra_pin: "P051234567X", contact_email: "info@nairobilive.co.ke", contact_phone: "0722334455", status: "verified", registered_at: "2026-06-02T09:00:00.000Z", doc_note: "Certificate of Incorporation + KRA PIN cert on file" },
      { id: "org-savannah-sounds", business_name: "Savannah Sounds Productions", kra_pin: "P051987654Y", contact_email: "hello@savannahsounds.co.ke", contact_phone: "0733445566", status: "pending", registered_at: "2026-09-15T14:20:00.000Z", doc_note: "Business registration certificate submitted, KRA PIN cert pending" },
      { id: "org-riftvalley-promo", business_name: "Rift Valley Promotions", kra_pin: "P051456789Z", contact_email: "accounts@rvpromotions.co.ke", contact_phone: "0711998877", status: "pending", registered_at: "2026-09-18T08:05:00.000Z", doc_note: "KRA PIN cert on file, business registration certificate pending" },
      { id: "org-coastline-ent", business_name: "Coastline Entertainment", kra_pin: "P051112233A", contact_email: "finance@coastlineent.co.ke", contact_phone: "0700556677", status: "suspended", registered_at: "2026-04-10T11:00:00.000Z", doc_note: "Suspended — repeated chargeback disputes", suspended_reason: "Repeated M-Pesa chargeback disputes under investigation" },
    ],
    adminUsers: [
      { id: "admin-you", name: "You", phone: "", role: "super_admin", status: "active", invited_at: "2026-01-01T00:00:00.000Z" },
    ],
    featureFlags: [
      { id: "flag-resale-v2", key: "resale_marketplace_v2", label: "Resale Marketplace v2", description: "New Seller Portal wizard and wallet UI.", enabled: true, rollout_percent: 100 },
      { id: "flag-scanner-offline", key: "offline_scanner_beta", label: "Offline Scanner PWA", description: "Fully offline gate validation after pre-event sync.", enabled: true, rollout_percent: 100 },
      { id: "flag-wallet-claim", key: "web3_wallet_claim", label: "Claim to Own Wallet", description: "Lets attendees self-custody a ticket NFT.", enabled: true, rollout_percent: 50 },
      { id: "flag-sms-notify", key: "sms_notifications", label: "SMS Notifications", description: "Transactional SMS for purchases and transfers.", enabled: false, rollout_percent: 0 },
      { id: "flag-organiser-analytics", key: "organiser_marketing_analytics", label: "Organiser Marketing Analytics", description: "Traffic-source and campaign reporting in Organiser Console.", enabled: true, rollout_percent: 100 },
    ],
    platformFeeConfig: { platformFeePercent: 5, scanningFeeKes: 10, minPayoutKes: 101, sellerEscrowDays: 2, organiserEscrowDays: 4, effectiveFrom: "2026-01-01T00:00:00.000Z" },
    platformFeeConfigHistory: [],
    platformBroadcasts: [], // Communication Center — empty by default, no seed drama
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return freshDb();
    const parsed = JSON.parse(raw);
    if (!parsed.events?.length) return freshDb();
    return parsed;
  } catch {
    return freshDb();
  }
}

let db = loadDb();
function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function resetMockDb() {
  db = freshDb();
  save();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function currentUserId() {
  const token = getToken();
  if (!token?.startsWith("mock.")) return null;
  return token.slice("mock.".length);
}

function requireUser() {
  const id = currentUserId();
  if (!id) throw new ApiError("Not authenticated", 403);
  return id;
}

function findUserById(id) {
  return Object.values(db.users).find((u) => u.id === id);
}

/** includeHidden: Organiser-facing callers see every tier; the public (Attendee) view never sees visibility:'hidden' tiers. */
function eventSummary(ev, { includeHidden = false } = {}) {
  const visibleTiers = includeHidden ? ev.tiers : ev.tiers.filter((t) => t.visibility !== "hidden");
  const capacity = ev.tiers.reduce((sum, t) => sum + t.capacity, 0);
  const sold = ev.tiers.reduce((sum, t) => sum + t.tickets_sold, 0);
  const remaining = capacity - sold;
  const cheapest = [...visibleTiers].sort((a, b) => a.price - b.price)[0];
  const fractionLeft = capacity > 0 ? remaining / capacity : 0;
  const availability =
    ev.status === "sold_out" || remaining <= 0 ? "sold_out" : fractionLeft <= 0.15 ? "selling_fast" : "available";

  return {
    id: ev.id,
    title: ev.title,
    category: ev.category,
    description: ev.description,
    description_html: ev.description_html || "",
    image_data_url: ev.image_data_url || null,
    venue: ev.venue,
    map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue)}`,
    event_date: ev.event_date,
    ends_at: ev.ends_at || null,
    organizer_phone: ev.organizer_phone,
    organizer_name: ev.organizer_name,
    artists: ev.artists || [],
    ticket_price_kes: cheapest?.price ?? 0,
    total_capacity: capacity,
    tickets_sold: sold,
    tickets_remaining: remaining,
    availability, // 'available' | 'selling_fast' | 'sold_out'
    max_resale_price_kes: cheapest ? Math.round(cheapest.price * ev.resale.ceilingMultiplier) : 0,
    resale_royalty_percent: ev.resale.royaltyPercent,
    resale_ceiling_multiplier: ev.resale.ceilingMultiplier,
    resale_enabled: ev.resale.resaleEnabled,
    resale_window_open_days: ev.resale.windowOpenDays,
    resale_window_close_hours: ev.resale.windowCloseHours,
    status: ev.status,
    contract_address: mockContractAddress(ev.id),
    gates: ev.gates || [],
    tiers: (includeHidden ? ev.tiers : visibleTiers).map((t) => ({
      ...t,
      tickets_remaining: t.capacity - t.tickets_sold,
      resale_floor_kes: t.price,
      resale_ceiling_kes: Math.round(t.price * ev.resale.ceilingMultiplier),
    })),
  };
}

function buildTiersFromForm(tiers) {
  return tiers.map((t) => ({
    id: t.id || uuid(),
    name: t.name,
    description: t.description || "",
    price: Number(t.price),
    capacity: Number(t.capacity),
    tickets_sold: t.tickets_sold || 0,
    salesStart: t.salesStart || null,
    salesEnd: t.salesEnd || null,
    perOrderMax: Number(t.perOrderMax) || 4,
    visibility: t.visibility || "public",
  }));
}

/** Deterministic mock contract address per event — Blockchain > Contract Status. */
function mockContractAddress(eventId) {
  let hash = 0;
  for (let i = 0; i < eventId.length; i++) hash = (Math.imul(hash, 31) + eventId.charCodeAt(i)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  return "0x" + (hex + hex + hex + hex + hex).slice(0, 40);
}

const MINT_DELAY_MS = 3500; // simulated time for the "mint" to confirm on-chain

function mockTxHash() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function activatePayment(paymentId) {
  const payment = db.payments.find((p) => p.id === paymentId);
  if (!payment || payment.status !== "initiated") return;
  if (payment.listing_id) {
    payment.status = "success";
    payment.confirmed_at = new Date().toISOString();
    payment.mpesa_receipt_number = `M${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const listing = db.listings.find((l) => l.id === payment.listing_id);
    const buyer = findUserById(payment.user_id);
    if (listing && buyer) settleMockSale(listing, buyer);
    save();
    return;
  }

  payment.status = "success";
  payment.confirmed_at = new Date().toISOString();
  payment.mpesa_receipt_number = `M${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  const ticket = db.tickets.find((t) => t.id === payment.ticket_id);
  if (ticket) {
    ticket.status = "active";
    ticket.purchased_at = payment.confirmed_at;
    // Spec §3.2: "The ticket is usable before the mint confirms" — it's active
    // (QR works, gate would admit it) immediately; chain_status just informs
    // the ChainBadge shown on Confirmation/Ticket-credential, nothing gates on it.
    ticket.chain_status = "pending";

    const event = db.events.find((e) => e.id === ticket.event_id);
    const tier = event?.tiers.find((t) => t.id === ticket.tier_id);
    if (tier) tier.tickets_sold += 1;
    ticket.gate_assignment = event?.gates?.[0]?.name || "Gate A";

    if (event && !ticket.is_complimentary) {
      const chaintixFeeKes = Math.round(payment.amount_kes * (PLATFORM_FEE_PERCENT / 100));
      const netKes = payment.amount_kes - chaintixFeeKes - SCANNING_FEE_PER_TICKET_KES;
      db.organiserWalletTransactions.push({
        id: uuid(),
        event_id: event.id,
        type: "primary_sale",
        description: `Ticket sale — ${event.title}`,
        gross: payment.amount_kes,
        chaintix_fee: chaintixFeeKes,
        scanning_fee: SCANNING_FEE_PER_TICKET_KES,
        net: netKes,
        created_at: new Date().toISOString(),
        available_at: new Date(new Date(event.event_date).getTime() + 4 * 24 * 3600 * 1000).toISOString(),
      });
      if (event.tiers.every((t) => t.tickets_sold >= t.capacity)) event.status = "sold_out";
    }

    setTimeout(() => {
      const t = db.tickets.find((x) => x.id === ticket.id);
      if (!t) return;
      t.chain_status = "verified";
      t.nft_token_id = Math.floor(1000 + Math.random() * 8999);
      t.nft_tx_hash = mockTxHash();
      t.minted_at = new Date().toISOString();
      save();
    }, MINT_DELAY_MS);
  }
  save();
}

// ─── Seller Portal helpers ──────────────────────────────────────────────────

const PLATFORM_FEE_PERCENT = 5;
const SCANNING_FEE_PER_TICKET_KES = 10; // "door scanning costs" — spec §5.3
const MIN_WITHDRAWAL_KES = 101;
const RESALE_REVIEW_MS = 2500; // simulated moderation delay before a listing goes live

function eventAndTierFor(ticket) {
  const event = db.events.find((e) => e.id === ticket.event_id);
  const tier = event?.tiers.find((t) => t.id === ticket.tier_id);
  return { event, tier };
}

/** Why a given ticket can or can't be listed — spec §4.3 step 1's inline reasons.
 * Window bounds are per-event organiser settings (spec §5.2's resale window fields),
 * not a fixed rule. */
function ticketEligibility(ticket, event) {
  if (ticket.status === "used") return { eligible: false, reason: "Already used" };
  if (ticket.status === "resale") return { eligible: false, reason: "Already listed for resale" };
  if (ticket.status !== "active") return { eligible: false, reason: "Payment not yet confirmed" };
  if (event.resale.resaleEnabled === false) return { eligible: false, reason: "Resale disabled by organiser" };
  const msToEvent = new Date(event.event_date).getTime() - Date.now();
  if (msToEvent < 0) return { eligible: false, reason: "Event has ended" };
  if (msToEvent < event.resale.windowCloseHours * 3600 * 1000) return { eligible: false, reason: "Listing window closed" };
  if (ticket.purchased_at) {
    const msSincePurchase = Date.now() - new Date(ticket.purchased_at).getTime();
    if (msSincePurchase < event.resale.windowOpenDays * 24 * 3600 * 1000) {
      return { eligible: false, reason: "Listing window not open yet" };
    }
  }
  return { eligible: true, reason: null };
}

function resaleBounds(event, tier) {
  const ceiling = Math.round(tier.price * event.resale.ceilingMultiplier);
  return { floor: tier.price, ceiling };
}

// Why a buyer can't buy this listing right now, or null (mirrors the real
// backend's _buy_block_reason).
function listingBlockReason(listing) {
  const event = db.events.find((e) => e.id === listing.event_id);
  if (!event || !["live", "sold_out"].includes(event.status)) return "This event isn't on sale right now";
  if (new Date(event.event_date).getTime() <= Date.now()) return "This event has already started";
  if (event.resale.resaleEnabled === false) return "The organiser has turned off resale for this event";
  const closeMs = (event.resale.windowCloseHours || 0) * 3600 * 1000;
  if (closeMs && Date.now() > new Date(event.event_date).getTime() - closeMs) {
    return `Resale closed ${event.resale.windowCloseHours} hour(s) before the event`;
  }
  return null;
}

// Moves a sold listing's ticket to its buyer and records seller payout +
// organiser royalty — shared by a real (mock) purchase and devSimulateSale.
function settleMockSale(listing, buyer) {
  const event = db.events.find((e) => e.id === listing.event_id);
  listing.status = "sold";
  listing.sold_at = new Date().toISOString();
  listing.buyer_id = buyer.id;

  const ticket = db.tickets.find((t) => t.id === listing.ticket_id);
  if (ticket) {
    ticket.owner_id = buyer.id;
    ticket.status = "active";
  }

  const royaltyKes = Math.round(listing.price * (event.resale.royaltyPercent / 100));
  const platformFeeKes = Math.round(listing.price * (PLATFORM_FEE_PERCENT / 100));
  const payoutKes = listing.price - royaltyKes - platformFeeKes;
  const availableAt = new Date(new Date(event.event_date).getTime() + 2 * 24 * 3600 * 1000).toISOString();

  db.walletTransactions.push({
    id: uuid(),
    user_id: listing.seller_id,
    type: "sale",
    description: `Ticket sold — ${event.title}`,
    amount: payoutKes,
    status: "success",
    created_at: new Date().toISOString(),
    available_at: availableAt,
  });

  // The organiser's cut of every resale — Blockchain > Royalty Ledger.
  if (royaltyKes > 0) {
    db.organiserWalletTransactions.push({
      id: uuid(),
      event_id: event.id,
      type: "royalty",
      description: `Resale royalty — ${event.title}`,
      listing_id: listing.id,
      resale_price_kes: listing.price,
      gross: royaltyKes,
      net: royaltyKes,
      tx_hash: mockTxHash(),
      created_at: new Date().toISOString(),
      available_at: availableAt,
    });
  }
}

function listingSummary(listing) {
  const ticket = db.tickets.find((t) => t.id === listing.ticket_id);
  const event = db.events.find((e) => e.id === listing.event_id);
  const tier = event?.tiers.find((t) => t.id === listing.tier_id);
  const royaltyKes = Math.round(listing.price * (event.resale.royaltyPercent / 100));
  const platformFeeKes = Math.round(listing.price * (PLATFORM_FEE_PERCENT / 100));
  return {
    id: listing.id,
    ticket_id: listing.ticket_id,
    status: listing.status,
    price: listing.price,
    payout_kes: listing.price - royaltyKes - platformFeeKes,
    royalty_kes: royaltyKes,
    platform_fee_kes: platformFeeKes,
    views: listing.views,
    listed_at: listing.listed_at,
    sold_at: listing.sold_at,
    pause_reason: listing.pause_reason,
    event_id: event.id,
    event_title: event.title,
    event_date: event.event_date,
    venue: event.venue,
    tier_name: tier?.name,
    category: event.category,
    image_data_url: event.image_data_url || null,
    face_value_kes: tier?.price,
    resale_floor_kes: resaleBounds(event, tier).floor,
    resale_ceiling_kes: resaleBounds(event, tier).ceiling,
    checked_in: ticket?.status === "used",
  };
}

function computeWallet(userId) {
  const txs = db.walletTransactions.filter((t) => t.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  let available = 0;
  let pending = 0;
  let onHold = 0;

  for (const t of txs) {
    if (t.type === "withdrawal") {
      available += t.amount; // stored negative
      continue;
    }
    const disputed = db.disputes.some((d) => d.transaction_id === t.id && d.status !== "resolved");
    if (disputed) onHold += t.amount;
    else if (new Date(t.available_at) <= new Date()) available += t.amount;
    else pending += t.amount;
  }

  return { available, pending, onHold, transactions: txs };
}

// ─── Organiser Console helpers ──────────────────────────────────────────────

/** Platform-wide organiser wallet — see the freshDb() note on why this is a singleton. */
function computeOrganiserWallet() {
  let available = 0;
  let pending = 0;
  let paidOut = 0;
  for (const t of db.organiserWalletTransactions) {
    if (t.type === "payout") {
      paidOut += -t.net;
      continue;
    }
    if (new Date(t.available_at) <= new Date()) available += t.net;
    else pending += t.net;
  }
  return { available, pending, totalPaidOut: paidOut };
}

function maskedPhoneFor(userId) {
  const user = findUserById(userId);
  if (!user) return "";
  const digits = user.phone_number.replace(/\D/g, "");
  return `${"*".repeat(Math.max(digits.length - 3, 0))}${digits.slice(-3)}`;
}

function ticketLifecycleTimeline(ticket) {
  const events = [{ label: "Purchased", at: ticket.created_at }];
  if (ticket.purchased_at) events.push({ label: "Payment confirmed", at: ticket.purchased_at });
  if (ticket.minted_at) events.push({ label: "Minted on-chain", at: ticket.minted_at, tx_hash: ticket.nft_tx_hash });
  const listing = db.listings.find((l) => l.ticket_id === ticket.id);
  if (listing) {
    events.push({ label: "Listed for resale", at: listing.listed_at });
    if (listing.status === "sold") events.push({ label: "Resold", at: listing.sold_at });
  }
  if (ticket.transfer) events.push({ label: "Transferred", at: ticket.transfer.at });
  if (ticket.used_at) events.push({ label: "Admitted at gate", at: ticket.used_at });
  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function suspiciousFlagsFor(ticket) {
  const flags = [];
  const deniedScans = db.admissions.filter((a) => a.ticket_id === ticket.id && a.result === "denied");
  if (deniedScans.length >= 2) flags.push(`${deniedScans.length} failed scan attempts`);
  const wasResold = db.listings.some((l) => l.ticket_id === ticket.id && l.status === "sold");
  if (ticket.transfer && wasResold) flags.push("Rapid ownership changes — transferred and resold");
  const unassignedGateScans = db.admissions.filter((a) => {
    if (a.ticket_id !== ticket.id || a.result !== "granted") return false;
    const event = db.events.find((e) => e.id === a.event_id);
    return event && !event.gates.some((g) => g.id === a.gate_id);
  });
  if (unassignedGateScans.length > 0) flags.push("Admitted from an unassigned gate");
  return flags;
}

function ticketCentralRow(ticket) {
  const event = db.events.find((e) => e.id === ticket.event_id);
  const tier = event?.tiers.find((t) => t.id === ticket.tier_id);
  return {
    ticket_id: ticket.id,
    event_id: event?.id,
    event_title: event?.title,
    tier_name: tier?.name,
    holder_phone_masked: maskedPhoneFor(ticket.owner_id),
    status: ticket.status,
    purchased_at: ticket.purchased_at,
    nft_token_id: ticket.nft_token_id,
    chain_status: ticket.chain_status,
    gate_assignment: ticket.gate_assignment,
    checked_in: ticket.status === "used",
    is_complimentary: Boolean(ticket.is_complimentary),
    timeline: ticketLifecycleTimeline(ticket),
    suspicious: suspiciousFlagsFor(ticket),
  };
}

// ─── Platform Admin helpers ─────────────────────────────────────────────────

function computeFraudSignals() {
  const deniedByTicket = {};
  for (const a of db.admissions) {
    if (a.result !== "denied" || !a.ticket_id) continue;
    deniedByTicket[a.ticket_id] = (deniedByTicket[a.ticket_id] || 0) + 1;
  }
  const repeatedFailedScans = Object.entries(deniedByTicket)
    .filter(([, count]) => count >= 3)
    .map(([ticketId, count]) => {
      const ticket = db.tickets.find((t) => t.id === ticketId);
      const event = ticket ? db.events.find((e) => e.id === ticket.event_id) : null;
      return { ticket_id: ticketId, event_title: event?.title || "Unknown event", denied_count: count };
    })
    .sort((a, b) => b.denied_count - a.denied_count);

  const listingsByUser = {};
  for (const l of db.listings) {
    if (!["active", "sold", "paused", "pending_review"].includes(l.status)) continue;
    listingsByUser[l.seller_id] = (listingsByUser[l.seller_id] || 0) + 1;
  }
  const unusualVelocity = Object.entries(listingsByUser)
    .filter(([, count]) => count >= 3)
    .map(([userId, count]) => ({ phone_masked: maskedPhoneFor(userId), listing_count: count }))
    .sort((a, b) => b.listing_count - a.listing_count);

  const devicesByName = {};
  for (const s of db.gateScanners) {
    if (!devicesByName[s.device_name]) devicesByName[s.device_name] = new Set();
    devicesByName[s.device_name].add(s.event_id);
  }
  const duplicateDevices = Object.entries(devicesByName)
    .filter(([, events]) => events.size > 1)
    .map(([deviceName, events]) => ({ device_name: deviceName, event_count: events.size }));

  return { repeatedFailedScans, unusualVelocity, duplicateDevices };
}

function computePayoutQueueDepth() {
  const now = Date.now();
  const sellerPending = db.walletTransactions.filter((t) => t.available_at && new Date(t.available_at).getTime() > now).length;
  const organiserPending = db.organiserWalletTransactions.filter((t) => t.available_at && new Date(t.available_at).getTime() > now).length;
  return sellerPending + organiserPending;
}

// ─── Mock API ───────────────────────────────────────────────────────────────

export const mockApi = {
  // No Firebase in the mock (health reports no firebase config, so the login
  // screen uses its plain phone step).
  googlePhone: async () => {
    throw new ApiError("Google sign-in needs the real backend.", 501);
  },

  firebaseLogin: async () => {
    throw new ApiError("Firebase sign-in needs the real backend.", 501);
  },

  health: async () => {
    await delay(120);
    return { status: "ok", service: "TiketiKE API (mock)", version: "mock", env: "development" };
  },

  login: async (phoneNumber) => {
    await delay(300);
    let user = db.users[phoneNumber];
    if (!user) {
      user = { id: uuid(), phone_number: phoneNumber };
      db.users[phoneNumber] = user;
      save();
    }
    const token = `mock.${user.id}`;
    setToken(token);
    return { access_token: token, user_id: user.id, phone_number: user.phone_number };
  },

  // ── My account (mock) — derived from the same local data the mock pages use.
  getProfile: async () => {
    const userId = requireUser();
    await delay(200);
    const user = findUserById(userId);
    const now = Date.now();
    const mine = db.tickets.filter((t) => t.owner_id === userId);
    const held = mine.filter((t) => ["active", "resale"].includes(t.status));
    const eventOf = (t) => db.events.find((e) => e.id === t.event_id);
    const listings = db.listings.filter((l) => l.seller_id === userId);
    const wallet = computeWallet(userId);
    return {
      user: { id: userId, phone_number: user.phone_number, display_name: user.display_name || null, email: null, google_linked: false, member_since: user.created_at || null },
      security: { sign_in_methods: ["Phone"], last_sign_in: null },
      attendee: {
        tickets_held: held.length,
        upcoming_events: new Set(held.filter((t) => new Date(eventOf(t)?.event_date).getTime() > now).map((t) => t.event_id)).size,
        events_attended: new Set(mine.filter((t) => t.status === "used").map((t) => t.event_id)).size,
      },
      seller: {
        active_listings: listings.filter((l) => ["active", "paused", "pending_review"].includes(l.status)).length,
        tickets_sold: listings.filter((l) => l.status === "sold").length,
        available_kes: wallet.available,
        pending_kes: wallet.pending,
      },
      organisations: [],
      platform_admin: false,
    };
  },

  updateProfile: async ({ displayName }) => {
    const userId = requireUser();
    await delay(250);
    const name = (displayName || "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 60) throw new ApiError("Your name must be 1-60 characters.", 422);
    findUserById(userId).display_name = name;
    save();
    return mockApi.getProfile();
  },

  getActivity: async ({ before, category } = {}) => {
    const userId = requireUser();
    await delay(200);
    const items = [];
    for (const p of db.payments.filter((x) => x.user_id === userId)) {
      const t = db.tickets.find((x) => x.id === p.ticket_id);
      const ev = db.events.find((e) => e.id === t?.event_id);
      if (p.status === "success") {
        items.push({ id: `purchase:${p.id}`, kind: p.listing_id ? "resale_bought" : "purchase", category: p.listing_id ? "resale" : "purchase", at: p.confirmed_at || p.initiated_at,
          title: `${p.listing_id ? "Bought a resale ticket" : "Bought 1 ticket"} for ${ev?.title || "an event"}`, detail: p.mpesa_receipt_number ? `M-Pesa ${p.mpesa_receipt_number}` : null, amount_kes: -p.amount_kes, link: "/tickets" });
      }
    }
    for (const l of db.listings.filter((x) => x.seller_id === userId)) {
      const ev = db.events.find((e) => e.id === l.event_id);
      items.push({ id: `listed:${l.id}`, kind: "listed", category: "resale", at: l.listed_at, title: `Listed a ticket for ${ev?.title || "an event"}`, detail: `Asking KES ${l.price}`, amount_kes: null, link: "/seller/listings" });
      if (l.status === "sold" && l.sold_at) items.push({ id: `sold:${l.id}`, kind: "sold", category: "resale", at: l.sold_at, title: `Sold your ticket for ${ev?.title || "an event"}`, detail: null, amount_kes: listingSummary(l).payout_kes, link: "/seller/wallet" });
    }
    let out = items.filter((i) => i.at).sort((a, b) => (a.at < b.at ? 1 : -1));
    if (category) out = out.filter((i) => i.category === category);
    if (before) out = out.filter((i) => i.at < before);
    return { items: out.slice(0, 50), has_more: out.length > 50 };
  },

  signOutEverywhere: async () => {
    requireUser();
    await delay(200);
    // The mock has no server-side sessions to end.
    return { access_token: getToken(), token_type: "bearer" };
  },

  me: async () => {
    const id = requireUser();
    const user = findUserById(id);
    if (!user) throw new ApiError("User not found", 401);
    return { id: user.id, phone_number: user.phone_number, display_name: null, email: null, wallet_address: null, created_at: new Date().toISOString() };
  },

  listEvents: async () => {
    await delay(250);
    return db.events.filter((e) => e.status === "live" || e.status === "sold_out").map((e) => eventSummary(e));
  },

  getEvent: async (id) => {
    await delay(200);
    const ev = db.events.find((e) => e.id === id);
    if (!ev) throw new ApiError("Event not found", 404);
    return eventSummary(ev);
  },

  /** Organiser Console — every event regardless of status, tiers include hidden ones. */
  getOrganiserEvents: async () => {
    requireUser();
    await delay(250);
    return db.events.map((e) => eventSummary(e, { includeHidden: true }));
  },

  getOrganiserEvent: async (id) => {
    requireUser();
    await delay(200);
    const ev = db.events.find((e) => e.id === id);
    if (!ev) throw new ApiError("Event not found", 404);
    return eventSummary(ev, { includeHidden: true });
  },

  createEvent: async (payload) => {
    const userId = requireUser();
    await delay(400);
    const tiers = buildTiersFromForm(
      payload.tiers?.length ? payload.tiers : [{ name: "General", price: payload.ticket_price_kes, capacity: payload.total_capacity }]
    );
    const user = findUserById(userId);

    const ev = {
      id: uuid(),
      title: payload.title,
      category: payload.category || "Music",
      description: payload.description || "",
      description_html: payload.description_html || "",
      image_data_url: payload.image_data_url || null,
      venue: payload.venue,
      event_date: payload.event_date,
      ends_at: payload.ends_at || null,
      organizer_phone: payload.organizer_phone || user?.phone_number,
      organizer_name: payload.organizer_name || "You",
      artists: payload.artists || [],
      total_capacity: Number(payload.total_capacity) || tiers.reduce((s, t) => s + t.capacity, 0),
      status: payload.status || "live",
      tiers,
      gates: (payload.gates?.length ? payload.gates : [{ name: "Gate A" }]).map((g) => ({ id: g.id || uuid(), name: g.name })),
      resale: {
        ceilingMultiplier: payload.max_resale_multiplier ?? 1.2,
        royaltyPercent: payload.resale_royalty_percent ?? 10,
        resaleEnabled: payload.resale_enabled ?? true,
        windowOpenDays: Number(payload.resale_window_open_days) || 0,
        windowCloseHours: Number(payload.resale_window_close_hours) || 2,
      },
      created_at: new Date().toISOString(),
    };
    db.events.unshift(ev);
    save();
    return eventSummary(ev, { includeHidden: true });
  },

  updateEvent: async (eventId, payload) => {
    requireUser();
    await delay(400);
    const ev = db.events.find((e) => e.id === eventId);
    if (!ev) throw new ApiError("Event not found", 404);

    Object.assign(ev, {
      title: payload.title ?? ev.title,
      category: payload.category ?? ev.category,
      description: payload.description ?? ev.description,
      description_html: payload.description_html ?? ev.description_html,
      image_data_url: payload.image_data_url ?? ev.image_data_url,
      venue: payload.venue ?? ev.venue,
      event_date: payload.event_date ?? ev.event_date,
      ends_at: payload.ends_at ?? ev.ends_at,
      artists: payload.artists ?? ev.artists,
      status: payload.status ?? ev.status,
      total_capacity: payload.total_capacity ? Number(payload.total_capacity) : ev.total_capacity,
    });
    if (payload.tiers) ev.tiers = buildTiersFromForm(payload.tiers);
    if (payload.gates) ev.gates = payload.gates.map((g) => ({ id: g.id || uuid(), name: g.name }));
    if (payload.max_resale_multiplier != null || payload.resale_royalty_percent != null || payload.resale_enabled != null) {
      ev.resale = {
        ...ev.resale,
        ceilingMultiplier: payload.max_resale_multiplier ?? ev.resale.ceilingMultiplier,
        royaltyPercent: payload.resale_royalty_percent ?? ev.resale.royaltyPercent,
        resaleEnabled: payload.resale_enabled ?? ev.resale.resaleEnabled,
        windowOpenDays: payload.resale_window_open_days != null ? Number(payload.resale_window_open_days) : ev.resale.windowOpenDays,
        windowCloseHours: payload.resale_window_close_hours != null ? Number(payload.resale_window_close_hours) : ev.resale.windowCloseHours,
      };
    }
    save();
    return eventSummary(ev, { includeHidden: true });
  },

  purchaseTicket: async (payload) => {
    const userId = requireUser();
    await delay(350);
    const event = db.events.find((e) => e.id === payload.event_id);
    if (!event) throw new ApiError("Event not found", 404);

    const tier = payload.tier_id ? event.tiers.find((t) => t.id === payload.tier_id) : event.tiers.find((t) => t.visibility !== "hidden");
    if (!tier) throw new ApiError("Ticket tier not found", 404);
    if (tier.capacity - tier.tickets_sold <= 0) throw new ApiError("Event is sold out", 400);
    if (tier.salesStart && new Date(tier.salesStart) > new Date()) throw new ApiError("Sales for this tier haven't opened yet.", 400);
    if (tier.salesEnd && new Date(tier.salesEnd) < new Date()) throw new ApiError("Sales for this tier have closed.", 400);

    const existing = db.tickets.find(
      (t) => t.event_id === event.id && t.owner_id === userId && ["active", "pending_payment"].includes(t.status)
    );
    if (existing) throw new ApiError("You already have a ticket for this event", 400);

    const ticket = {
      id: uuid(),
      event_id: event.id,
      tier_id: tier.id,
      owner_id: userId,
      status: "pending_payment",
      seat_number: null,
      purchased_at: null,
      used_at: null,
      is_complimentary: false,
      created_at: new Date().toISOString(),
    };
    db.tickets.push(ticket);

    const payment = {
      id: uuid(),
      ticket_id: ticket.id,
      tier_id: tier.id,
      user_id: userId,
      amount_kes: tier.price,
      status: "initiated",
      checkout_request_id: `mock-checkout-${uuid().slice(0, 8)}`,
      phone_number: payload.phone_number,
      initiated_at: new Date().toISOString(),
      confirmed_at: null,
      mpesa_receipt_number: null,
    };
    db.payments.push(payment);
    save();

    // Simulate the attendee approving the STK push on their phone.
    setTimeout(() => activatePayment(payment.id), PAYMENT_DELAY_MS);

    return { ticket_id: ticket.id, payment_id: payment.id, checkout_request_id: payment.checkout_request_id, message: "STK push sent. Confirm payment on your phone." };
  },

  getPaymentStatus: async (paymentId) => {
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!payment) throw new ApiError("Payment not found", 404);
    return { id: payment.id, payment_id: payment.id, status: payment.status, mpesa_receipt_number: payment.mpesa_receipt_number, amount_kes: payment.amount_kes, initiated_at: payment.initiated_at, confirmed_at: payment.confirmed_at };
  },

  devConfirmPayment: async (paymentId) => {
    await delay(150);
    activatePayment(paymentId);
    return mockApi.getPaymentStatus(paymentId);
  },

  myTickets: async () => {
    const userId = requireUser();
    await delay(200);
    return db.tickets
      .filter((t) => t.owner_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((t) => ({
        id: t.id,
        event_id: t.event_id,
        owner_id: t.owner_id,
        status: t.status,
        seat_number: t.seat_number,
        nft_token_id: t.nft_token_id ?? null,
        purchased_at: t.purchased_at,
        created_at: t.created_at,
      }));
  },

  /** Mock-only aggregate — event + tier + chain fields the Confirmation and
   * Ticket-credential screens need, none of which the real TicketOut/seed
   * contracts carry today. */
  getTicketDetail: async (ticketId) => {
    const userId = requireUser();
    await delay(150);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.owner_id === userId);
    if (!ticket) throw new ApiError("Ticket not found", 404);
    const event = db.events.find((e) => e.id === ticket.event_id);
    const tier = event?.tiers.find((t) => t.id === ticket.tier_id);
    return {
      ticket_id: ticket.id,
      status: ticket.status,
      event_id: event.id,
      event_title: event.title,
      venue: event.venue,
      event_date: event.event_date,
      tier_name: tier?.name,
      seat_number: ticket.seat_number,
      gate_assignment: ticket.gate_assignment || null,
      chain_status: ticket.chain_status || "pending",
      nft_token_id: ticket.nft_token_id ?? null,
      nft_tx_hash: ticket.nft_tx_hash ?? null,
      self_custodied: Boolean(ticket.self_custodied),
      wallet_address: ticket.wallet_address ?? null,
    };
  },

  getTicketSeed: async (ticketId) => {
    const userId = requireUser();
    await delay(150);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.owner_id === userId);
    if (!ticket) throw new ApiError("Ticket not found", 404);
    if (ticket.status !== "active") throw new ApiError(`Ticket is not active (status: ${ticket.status})`, 400);
    const event = db.events.find((e) => e.id === ticket.event_id);
    const tier = event.tiers.find((t) => t.id === ticket.tier_id);
    return {
      ticket_id: ticket.id,
      totp_secret: "MOCKSECRET",
      totp_issuer: "TiketiKE",
      event_title: event.title,
      event_date: new Date(event.event_date).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      venue: event.venue,
      tier_name: tier?.name,
      seat_number: ticket.seat_number,
      gate_assignment: ticket.gate_assignment || "Gate A",
      qr_payload: buildPayload(ticket.id),
    };
  },

  /** Mock-only — the explainer-sheet "Claim to my own wallet" flow. */
  claimTicketToWallet: async (ticketId, { walletAddress }) => {
    const userId = requireUser();
    await delay(600);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.owner_id === userId);
    if (!ticket) throw new ApiError("Ticket not found", 404);
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) throw new ApiError("Enter a valid wallet address.", 400);
    ticket.self_custodied = true;
    ticket.wallet_address = walletAddress;
    save();
    return { success: true };
  },

  getTicketQrBlob: async (ticketId) => {
    const payload = buildPayload(ticketId);
    const url = await QRCode.toDataURL(payload, { margin: 1, width: 440, color: { dark: "#14201a", light: "#ffffff" } });
    return { url, expiresIn: secondsUntilRotation() };
  },

  scanTicket: async (payload) => {
    await delay(300);
    const record = (ticketId, eventId, result, reason) => {
      db.admissions.push({
        id: uuid(),
        ticket_id: ticketId,
        event_id: eventId || null,
        gate_id: payload.gate_id || null,
        scanner_id: payload.scanner_id || null,
        result,
        reason: reason || null,
        scanned_at: new Date().toISOString(),
      });
      save();
    };

    const parsed = parseScanPayload(payload.qr_payload);
    if (!parsed) {
      record(null, null, "denied", "Invalid QR format");
      return { valid: false, reason: "Invalid QR format" };
    }
    const { ticketId, otp } = parsed;

    const ticket = db.tickets.find((t) => t.id === ticketId);
    const event = ticket ? db.events.find((e) => e.id === ticket.event_id) : null;
    const gateName = payload.gate_id ? event?.gates.find((g) => g.id === payload.gate_id)?.name : undefined;

    const decision = decideScan({ ticket, otp, gateName });
    if (!decision.granted) {
      record(ticketId, ticket?.event_id, "denied", decision.reason);
      return { valid: false, ticket_id: ticketId, reason: decision.reason };
    }

    ticket.status = "used";
    ticket.used_at = new Date().toISOString();
    record(ticketId, ticket.event_id, "granted", null);

    const owner = findUserById(ticket.owner_id);
    const phone = owner?.phone_number || "";
    return {
      valid: true,
      ticket_id: ticketId,
      event_title: event?.title,
      owner_phone: phone ? `${"*".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}` : "****",
      scanned_at: new Date(ticket.used_at).toLocaleTimeString("en-KE"),
    };
  },

  /** Scanner PWA §6.1 — the one real network call in the whole flow: pulls a
   * snapshot of every ticket for the event down to the device so §6.2/6.3
   * validation can run with zero further requests. Also registers/refreshes
   * this device in gateScanners so Organiser's Scanner Hub and Crowd Control
   * see it as an online, synced gate. */
  syncGateData: async ({ eventId, gateId }) => {
    requireUser();
    await delay(600);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    const gate = event.gates.find((g) => g.id === gateId);
    if (!gate) throw new ApiError("Gate not found", 404);

    const tickets = db.tickets
      .filter((t) => t.event_id === eventId && ["active", "used"].includes(t.status))
      .map((t) => {
        const tier = event.tiers.find((tt) => tt.id === t.tier_id);
        return {
          id: t.id,
          tier_name: tier?.name || "General",
          gate_assignment: t.gate_assignment || event.gates[0]?.name,
          status: t.status,
          used_at: t.used_at,
        };
      });

    let scanner = db.gateScanners.find((s) => s.event_id === eventId && s.gate_id === gateId && s.device_name === "Scanner PWA");
    if (!scanner) {
      scanner = { id: uuid(), event_id: eventId, gate_id: gateId, device_name: "Scanner PWA", operator_phone: null, status: "active", last_sync_at: null, created_at: new Date().toISOString() };
      db.gateScanners.push(scanner);
    }
    scanner.status = "active";
    scanner.last_sync_at = new Date().toISOString();
    save();

    return {
      scanner_id: scanner.id,
      event_title: event.title,
      gate_name: gate.name,
      event_date: event.event_date,
      ends_at: event.ends_at,
      tickets,
      total_count: tickets.length,
      synced_at: scanner.last_sync_at,
    };
  },

  /** Scanner PWA §6.4 reconciliation — uploads the batch of scans the device
   * recorded entirely offline. Applied once connectivity actually returns. */
  reportScanBatch: async ({ eventId, gateId, scannerId, scans }) => {
    requireUser();
    await delay(500);
    for (const s of scans) {
      const ticket = db.tickets.find((t) => t.id === s.ticket_id);
      if (ticket && s.result === "granted" && ticket.status === "active") {
        ticket.status = "used";
        ticket.used_at = s.scanned_at;
      }
      db.admissions.push({
        id: uuid(),
        ticket_id: s.ticket_id,
        event_id: eventId || null,
        gate_id: gateId || null,
        scanner_id: scannerId || null,
        result: s.result,
        reason: s.reason || null,
        scanned_at: s.scanned_at,
      });
    }
    const scanner = db.gateScanners.find((sc) => sc.id === scannerId);
    if (scanner) scanner.last_sync_at = new Date().toISOString();
    save();
    return { applied: scans.length, uploaded_at: new Date().toISOString() };
  },

  // ── Mock-only: no backend endpoint yet (Phase 6 resale / Organiser Console) ──

  transferTicket: async (ticketId, { recipient }) => {
    const userId = requireUser();
    await delay(500);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.owner_id === userId);
    if (!ticket) throw new ApiError("Ticket not found", 404);
    if (ticket.status !== "active") throw new ApiError("Only active tickets can be transferred", 400);

    let recipientUser = Object.values(db.users).find((u) => u.phone_number === recipient);
    if (!recipientUser) {
      recipientUser = { id: uuid(), phone_number: recipient };
      db.users[recipient] = recipientUser;
    }
    ticket.owner_id = recipientUser.id;
    ticket.transfer = { type: "gift", to: recipient, at: new Date().toISOString() };
    save();
    return { success: true, message: `Ticket transferred to ${recipient}.` };
  },

  // ── Seller Portal (spec.md §4) — all mock-only, Phase 6 territory ──────────

  /** Step 1 of the Sell wizard: every ticket the seller holds, with why it can/can't be listed. */
  getEligibleTickets: async () => {
    const userId = requireUser();
    await delay(250);
    return db.tickets
      .filter((t) => t.owner_id === userId)
      .map((t) => {
        const { event, tier } = eventAndTierFor(t);
        const elig = ticketEligibility(t, event);
        return {
          ticket_id: t.id,
          event_id: event.id,
          event_title: event.title,
          venue: event.venue,
          event_date: event.event_date,
          category: event.category,
          tier_name: tier?.name,
          face_value_kes: tier?.price,
          ...resaleBounds(event, tier),
          royalty_percent: event.resale.royaltyPercent,
          eligible: elig.eligible,
          ineligible_reason: elig.reason,
        };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible));
  },

  /** Step 3->4 of the Sell wizard: lists it, starts in pending_review, auto-approves shortly after (spec §4.4). */
  sellTicket: async (ticketId, { price }) => {
    const userId = requireUser();
    await delay(400);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.owner_id === userId);
    if (!ticket) throw new ApiError("Ticket not found", 404);
    const { event, tier } = eventAndTierFor(ticket);
    const elig = ticketEligibility(ticket, event);
    if (!elig.eligible) throw new ApiError(elig.reason, 400);

    const { floor, ceiling } = resaleBounds(event, tier);
    if (price > ceiling) {
      db.rejectedListingAttempts.push({ id: uuid(), event_id: event.id, attempted_price: price, cap: ceiling, at: new Date().toISOString() });
      save();
      throw new ApiError(`Above the maximum allowed for this event (KES ${ceiling}).`, 400);
    }
    if (price < floor) throw new ApiError(`Resale price can't be below face value (KES ${floor}).`, 400);

    const listing = {
      id: uuid(),
      ticket_id: ticket.id,
      seller_id: userId,
      event_id: event.id,
      tier_id: tier.id,
      price: Math.round(price),
      status: "pending_review",
      views: 0,
      listed_at: new Date().toISOString(),
      pause_reason: null,
      sold_at: null,
      buyer_id: null,
    };
    db.listings.push(listing);
    ticket.status = "resale";
    save();

    setTimeout(() => {
      const l = db.listings.find((x) => x.id === listing.id);
      if (l?.status === "pending_review") {
        l.status = "active";
        save();
      }
    }, RESALE_REVIEW_MS);

    return { listing_id: listing.id, status: listing.status };
  },

  getSellerDashboard: async () => {
    const userId = requireUser();
    await delay(300);
    const listings = db.listings.filter((l) => l.seller_id === userId);
    const wallet = computeWallet(userId);
    return {
      stats: {
        totalListings: listings.length,
        pendingReview: listings.filter((l) => l.status === "pending_review").length,
        liveListings: listings.filter((l) => l.status === "active").length,
        soldTickets: listings.filter((l) => l.status === "sold").length,
      },
      wallet: { available: wallet.available, pending: wallet.pending, onHold: wallet.onHold },
      recentTransactions: wallet.transactions.slice(0, 6).map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        amount: t.amount,
        status: t.status,
        created_at: t.created_at,
      })),
    };
  },

  getMyListings: async () => {
    const userId = requireUser();
    await delay(300);
    return db.listings
      .filter((l) => l.seller_id === userId)
      .sort((a, b) => new Date(b.listed_at) - new Date(a.listed_at))
      .map(listingSummary);
  },

  repriceListing: async (listingId, { price }) => {
    const userId = requireUser();
    await delay(350);
    const listing = db.listings.find((l) => l.id === listingId && l.seller_id === userId);
    if (!listing) throw new ApiError("Listing not found", 404);
    const event = db.events.find((e) => e.id === listing.event_id);
    const tier = event.tiers.find((t) => t.id === listing.tier_id);
    const { floor, ceiling } = resaleBounds(event, tier);
    if (price > ceiling) {
      db.rejectedListingAttempts.push({ id: uuid(), event_id: event.id, attempted_price: price, cap: ceiling, at: new Date().toISOString() });
      save();
      throw new ApiError(`Above the maximum allowed for this event (KES ${ceiling}).`, 400);
    }
    if (price < floor) throw new ApiError(`Resale price can't be below face value (KES ${floor}).`, 400);
    listing.price = Math.round(price);
    if (listing.status === "paused") {
      listing.status = "active";
      listing.pause_reason = null;
    }
    save();
    return listingSummary(listing);
  },

  pauseListing: async (listingId) => {
    const userId = requireUser();
    await delay(250);
    const listing = db.listings.find((l) => l.id === listingId && l.seller_id === userId);
    if (!listing) throw new ApiError("Listing not found", 404);
    listing.status = "paused";
    listing.pause_reason = "Paused by you.";
    save();
    return listingSummary(listing);
  },

  cancelListing: async (listingId) => {
    const userId = requireUser();
    await delay(250);
    const listing = db.listings.find((l) => l.id === listingId && l.seller_id === userId);
    if (!listing) throw new ApiError("Listing not found", 404);
    listing.status = "cancelled";
    const ticket = db.tickets.find((t) => t.id === listing.ticket_id);
    if (ticket && ticket.status === "resale") ticket.status = "active";
    save();
    return listingSummary(listing);
  },

  /** Dev-only — there's no buyer-side "buy a resold ticket" flow built yet, so
   * this is the only way to reach the sold/escrow states the Wallet screen needs. */
  devSimulateSale: async (listingId) => {
    await delay(300);
    const listing = db.listings.find((l) => l.id === listingId);
    if (!listing || listing.status !== "active") throw new ApiError("This listing isn't active.", 400);

    const buyerPhone = `2547${Math.floor(10000000 + Math.random() * 89999999)}`;
    let buyer = Object.values(db.users).find((u) => u.phone_number === buyerPhone);
    if (!buyer) {
      buyer = { id: uuid(), phone_number: buyerPhone };
      db.users[buyerPhone] = buyer;
    }
    settleMockSale(listing, buyer);
    save();
    return { success: true };
  },

  // ── Resale marketplace (buyer side) ───────────────────────────────────────

  getResaleListings: async ({ eventId, sort = "price" } = {}) => {
    await delay(250);
    let rows = db.listings.filter((l) => l.status === "active" && !listingBlockReason(l));
    if (eventId) rows = rows.filter((l) => l.event_id === eventId);
    const out = rows.map(listingSummary);
    if (sort === "newest") out.sort((a, b) => new Date(b.listed_at) - new Date(a.listed_at));
    else if (sort === "date") out.sort((a, b) => new Date(a.event_date) - new Date(b.event_date) || a.price - b.price);
    else out.sort((a, b) => a.price - b.price);
    return out;
  },

  getResaleListing: async (listingId) => {
    await delay(200);
    const listing = db.listings.find((l) => l.id === listingId);
    if (!listing) throw new ApiError("Listing not found", 404);
    listing.views = (listing.views || 0) + 1;
    save();
    const reason = listing.status === "active" ? listingBlockReason(listing) : "This ticket is no longer available";
    return { ...listingSummary(listing), buyable: !reason, unavailable_reason: reason };
  },

  buyResaleListing: async (listingId, { phoneNumber }) => {
    const userId = requireUser();
    await delay(350);
    const listing = db.listings.find((l) => l.id === listingId);
    if (!listing) throw new ApiError("Listing not found", 404);
    if (listing.status !== "active") throw new ApiError("This listing is no longer available", 409);
    if (listing.seller_id === userId) throw new ApiError("You cannot buy your own listing", 400);
    const reason = listingBlockReason(listing);
    if (reason) throw new ApiError(reason, 400);

    listing.status = "pending_payment";
    const payment = {
      id: uuid(),
      ticket_id: listing.ticket_id,
      listing_id: listing.id,
      user_id: userId,
      amount_kes: listing.price,
      status: "initiated",
      checkout_request_id: `mock-checkout-${uuid().slice(0, 8)}`,
      phone_number: phoneNumber,
      initiated_at: new Date().toISOString(),
      confirmed_at: null,
      mpesa_receipt_number: null,
    };
    db.payments.push(payment);
    save();
    setTimeout(() => activatePayment(payment.id), PAYMENT_DELAY_MS);
    return { payment_id: payment.id, checkout_request_id: payment.checkout_request_id, message: "STK push sent. Confirm payment on your phone." };
  },

  getResalePurchase: async (paymentId) => {
    const userId = requireUser();
    await delay(150);
    const payment = db.payments.find((p) => p.id === paymentId && p.user_id === userId && p.listing_id);
    if (!payment) throw new ApiError("Purchase not found", 404);
    const listing = db.listings.find((l) => l.id === payment.listing_id);
    const status = payment.status === "success" ? "complete" : payment.status === "initiated" ? "awaiting_payment" : "failed";
    return {
      payment_id: payment.id,
      status,
      failure_reason: status === "failed" ? "The payment could not be completed." : null,
      ticket_id: status === "complete" ? payment.ticket_id : null,
      listing: listing ? listingSummary(listing) : null,
    };
  },

  getWallet: async () => {
    const userId = requireUser();
    await delay(250);
    const w = computeWallet(userId);
    return {
      available: w.available,
      pending: w.pending,
      onHold: w.onHold,
      minWithdrawalKes: MIN_WITHDRAWAL_KES,
      transactions: w.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        amount: t.amount,
        status: t.status,
        created_at: t.created_at,
        available_at: t.available_at ?? null,
      })),
    };
  },

  withdrawToMpesa: async ({ amount, phoneNumber }) => {
    const userId = requireUser();
    await delay(600);
    const wallet = computeWallet(userId);
    if (amount < MIN_WITHDRAWAL_KES) throw new ApiError(`Minimum withdrawal is KES ${MIN_WITHDRAWAL_KES}.`, 400);
    if (amount > wallet.available) throw new ApiError("That's more than your available balance.", 400);

    db.walletTransactions.push({
      id: uuid(),
      user_id: userId,
      type: "withdrawal",
      description: `Withdrawal to M-Pesa · ${phoneNumber}`,
      amount: -Math.round(amount),
      status: "success",
      created_at: new Date().toISOString(),
      available_at: null,
    });
    save();
    return { success: true };
  },

  getDisputes: async () => {
    requireUser();
    await delay(200);
    return db.disputes.slice();
  },

  /** Dev-only — reduces an event's resale cap and pauses any active listing that
   * now exceeds it, with the exact notice text spec §4.4 calls for. Demonstrates
   * that flow honestly since Organiser Console (where this would normally
   * happen) isn't built yet. */
  devCutResaleCap: async (eventId, newMultiplier) => {
    await delay(200);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    event.resale.ceilingMultiplier = newMultiplier;
    db.listings
      .filter((l) => l.event_id === eventId && l.status === "active")
      .forEach((l) => {
        const tier = event.tiers.find((t) => t.id === l.tier_id);
        const ceiling = Math.round(tier.price * newMultiplier);
        if (l.price > ceiling) {
          l.status = "paused";
          l.pause_reason = `The organiser reduced the maximum resale price for this event. Lower your price to KES ${ceiling} to relist.`;
        }
      });
    save();
    return { success: true };
  },

  // ── Organiser Console (spec.md §5) — platform-wide, no real multi-tenant
  // organizer-account model exists yet on either the mock or the real backend
  // (that's Phase 3 territory) — see the freshDb() note. ──────────────────────

  getOrganiserProfile: async () => {
    requireUser();
    await delay(200);
    return { ...db.organiserProfile };
  },

  updateOrganiserProfile: async (payload) => {
    requireUser();
    await delay(350);
    Object.assign(db.organiserProfile, payload);
    save();
    return { ...db.organiserProfile };
  },

  getPayoutDetails: async () => {
    requireUser();
    await delay(200);
    return { payoutMethod: db.organiserProfile.payoutMethod, payoutDestination: db.organiserProfile.payoutDestination };
  },

  updatePayoutDetails: async ({ payoutMethod, payoutDestination }) => {
    requireUser();
    await delay(350);
    db.organiserProfile.payoutMethod = payoutMethod;
    db.organiserProfile.payoutDestination = payoutDestination;
    save();
    return { success: true };
  },

  getTeamMembers: async () => {
    requireUser();
    await delay(250);
    return db.teamMembers.slice().sort((a, b) => new Date(a.invited_at) - new Date(b.invited_at));
  },

  inviteTeamMember: async ({ name, phone, role }) => {
    requireUser();
    await delay(350);
    const member = { id: uuid(), name, phone, role, status: "invited", invited_at: new Date().toISOString() };
    db.teamMembers.push(member);
    save();
    return member;
  },

  removeTeamMember: async (memberId) => {
    requireUser();
    await delay(250);
    db.teamMembers = db.teamMembers.filter((m) => m.id !== memberId);
    save();
    return { success: true };
  },

  getControlCenter: async () => {
    const userId = requireUser();
    await delay(300);
    const wallet = computeOrganiserWallet();
    const allTicketsSold = db.events.reduce((s, e) => s + e.tiers.reduce((ss, t) => ss + t.tickets_sold, 0), 0);
    const allRevenue = db.organiserWalletTransactions.filter((t) => t.type === "primary_sale").reduce((s, t) => s + t.gross, 0);

    const now = Date.now();
    const liveNowEvents = db.events.filter((e) => {
      const recentAdmission = db.admissions.some((a) => a.event_id === e.id && a.result === "granted" && now - new Date(a.scanned_at).getTime() < 2 * 3600 * 1000);
      const startingSoon = Math.abs(new Date(e.event_date).getTime() - now) < 6 * 3600 * 1000;
      return recentAdmission || startingSoon;
    });

    return {
      organiserName: findUserById(userId)?.phone_number || "there",
      activePlans: ["CORE TICKETING", "VIP MEMBERSHIP"],
      wallet: { available: wallet.available, pending: wallet.pending },
      allTimeTickets: allTicketsSold,
      allTimeRevenueKes: allRevenue,
      events: db.events.filter((e) => e.status === "live").map((e) => ({ id: e.id, title: e.title, tiers: e.tiers.map((t) => ({ id: t.id, name: t.name })) })),
      liveNow: liveNowEvents.map((e) => {
        const admitted = db.admissions.filter((a) => a.event_id === e.id && a.result === "granted").length;
        const denied = db.admissions.filter((a) => a.event_id === e.id && a.result === "denied").length;
        const total = admitted + denied;
        return {
          event_id: e.id,
          event_title: e.title,
          ticketsScanned: total,
          admissionRate: total ? Math.round((admitted / total) * 100) : 0,
          gatesOnline: db.gateScanners.filter((g) => g.event_id === e.id && g.status === "active").length,
          lastSyncAt: db.gateScanners.filter((g) => g.event_id === e.id).sort((a, b) => new Date(b.last_sync_at || 0) - new Date(a.last_sync_at || 0))[0]?.last_sync_at || null,
        };
      }),
    };
  },

  sendComplimentaryTicket: async ({ eventId, tierId, recipientName, recipientPhone, note }) => {
    requireUser();
    await delay(400);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    const tier = event.tiers.find((t) => t.id === tierId) || event.tiers[0];
    if (!tier) throw new ApiError("No ticket tier on this event.", 404);

    let recipient = Object.values(db.users).find((u) => u.phone_number === recipientPhone);
    if (!recipient) {
      recipient = { id: uuid(), phone_number: recipientPhone };
      db.users[recipientPhone] = recipient;
    }

    const ticket = {
      id: uuid(),
      event_id: event.id,
      tier_id: tier.id,
      owner_id: recipient.id,
      status: "active",
      seat_number: null,
      purchased_at: new Date().toISOString(),
      used_at: null,
      is_complimentary: true,
      complimentary_note: note || null,
      recipient_name: recipientName,
      chain_status: "pending",
      gate_assignment: event.gates?.[0]?.name || "Gate A",
      created_at: new Date().toISOString(),
    };
    db.tickets.push(ticket);
    tier.tickets_sold += 1;
    save();
    setTimeout(() => {
      const t = db.tickets.find((x) => x.id === ticket.id);
      if (!t) return;
      t.chain_status = "verified";
      t.nft_token_id = Math.floor(1000 + Math.random() * 8999);
      t.nft_tx_hash = mockTxHash();
      t.minted_at = new Date().toISOString();
      save();
    }, MINT_DELAY_MS);

    return { success: true, ticket_id: ticket.id };
  },

  getGuestLists: async () => {
    requireUser();
    await delay(250);
    return db.tickets
      .filter((t) => t.is_complimentary)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((t) => {
        const event = db.events.find((e) => e.id === t.event_id);
        const tier = event?.tiers.find((tt) => tt.id === t.tier_id);
        return {
          ticket_id: t.id,
          event_title: event?.title,
          tier_name: tier?.name,
          recipient_name: t.recipient_name,
          recipient_phone_masked: maskedPhoneFor(t.owner_id),
          note: t.complimentary_note,
          status: t.status,
          issued_at: t.created_at,
        };
      });
  },

  getAttendanceSummary: async () => {
    requireUser();
    await delay(300);
    return db.events.map((e) => {
      const capacity = e.tiers.reduce((s, t) => s + t.capacity, 0);
      const sold = e.tiers.reduce((s, t) => s + t.tickets_sold, 0);
      const admitted = db.admissions.filter((a) => a.event_id === e.id && a.result === "granted").length;
      return {
        event_id: e.id,
        event_title: e.title,
        event_date: e.event_date,
        capacity,
        sold,
        admitted,
        admissionRate: sold ? Math.round((admitted / sold) * 100) : 0,
      };
    });
  },

  getRevenueBreakdown: async () => {
    requireUser();
    await delay(300);
    const byCategory = {};
    const byTier = [];
    for (const e of db.events) {
      for (const t of e.tiers) {
        const revenue = t.tickets_sold * t.price;
        byCategory[e.category] = (byCategory[e.category] || 0) + revenue;
        if (revenue > 0) byTier.push({ event_title: e.title, tier_name: t.name, tickets_sold: t.tickets_sold, revenue });
      }
    }
    return {
      byCategory: Object.entries(byCategory).map(([category, revenue]) => ({ category, revenue })),
      byTier: byTier.sort((a, b) => b.revenue - a.revenue),
    };
  },

  getMarketingAnalytics: async ({ period = "week" } = {}) => {
    requireUser();
    await delay(300);
    // Deterministic mock traffic — no real analytics pipeline behind this yet.
    const scale = { today: 1, week: 7, month: 30, all: 120 }[period] || 7;
    const sources = [
      { source: "Direct", sessions: 42, conv: 0.18 },
      { source: "Instagram", sessions: 96, conv: 0.09 },
      { source: "WhatsApp", sessions: 61, conv: 0.24 },
      { source: "X", sessions: 28, conv: 0.07 },
      { source: "Referral", sessions: 15, conv: 0.31 },
    ].map((s) => {
      const sessions = Math.round(s.sessions * (scale / 7));
      const conversions = Math.round(sessions * s.conv);
      return { source: s.source, sessions, conversions, conversionRate: sessions ? Math.round((conversions / sessions) * 1000) / 10 : 0 };
    });
    const campaigns = [
      { name: "Launch — Instagram Stories", clicks: 340, conversions: 28, spend_kes: 4500 },
      { name: "WhatsApp broadcast", clicks: 190, conversions: 41, spend_kes: 0 },
      { name: "X promoted post", clicks: 88, conversions: 6, spend_kes: 2000 },
    ];
    return { sources, campaigns };
  },

  getExports: async () => {
    requireUser();
    await delay(200);
    return db.exportsRequested.slice().sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
  },

  requestExport: async ({ type, format }) => {
    requireUser();
    await delay(500);
    const req = { id: uuid(), type, format, status: "ready", requested_at: new Date().toISOString() };
    db.exportsRequested.unshift(req);
    save();
    return req;
  },

  downloadExport: async () => {
    throw new ApiError("Downloads need the real backend — the mock has no files to give you.", 501);
  },

  downloadReport: async () => {
    throw new ApiError("Downloads need the real backend — the mock has no files to give you.", 501);
  },

  updateTeamMemberRole: async (memberId, role) => {
    requireUser();
    const member = db.teamMembers.find((m) => m.id === memberId);
    if (!member) throw new ApiError("Member not found", 404);
    member.role = role;
    save();
    return member;
  },

  getReports: async () => {
    requireUser();
    await delay(250);
    return db.events
      .filter((e) => e.tiers.some((t) => t.tickets_sold > 0))
      .map((e) => ({ id: e.id, title: `${e.title} — Sales Statement`, event_title: e.title, generated_at: e.created_at }));
  },

  getEarnings: async () => {
    requireUser();
    await delay(350);
    const txs = db.organiserWalletTransactions;
    const primarySales = txs.filter((t) => t.type === "primary_sale");
    const royalties = txs.filter((t) => t.type === "royalty");
    const wallet = computeOrganiserWallet();

    const totalRevenue = primarySales.reduce((s, t) => s + t.gross, 0);
    const chaintixFee = primarySales.reduce((s, t) => s + t.chaintix_fee, 0);
    const scanningFees = primarySales.reduce((s, t) => s + t.scanning_fee, 0);
    const royaltyEarned = royalties.reduce((s, t) => s + t.net, 0);
    const yourEarnings = primarySales.reduce((s, t) => s + t.net, 0) + royaltyEarned;

    const perEvent = db.events
      .map((e) => {
        const eventPrimary = primarySales.filter((t) => t.event_id === e.id);
        const eventRoyalties = royalties.filter((t) => t.event_id === e.id);
        const online = eventPrimary.reduce((s, t) => s + t.gross, 0);
        const fees = eventPrimary.reduce((s, t) => s + t.chaintix_fee + t.scanning_fee, 0);
        const royaltyKes = eventRoyalties.reduce((s, t) => s + t.net, 0);
        return {
          event_id: e.id,
          event_title: e.title,
          event_date: e.event_date,
          online_sales_kes: online,
          gate_sales_kes: 0, // no cash/door-sales flow exists in this build
          resale_royalties_kes: royaltyKes,
          fees_kes: fees,
          net_kes: online - fees + royaltyKes,
          payout_status: new Date(e.event_date).getTime() + 4 * 24 * 3600 * 1000 <= Date.now() ? "Paid out" : "Pending",
          tiers: e.tiers.map((t) => ({ name: t.name, sold: t.tickets_sold, revenue: t.tickets_sold * t.price })),
        };
      })
      .filter((row) => row.online_sales_kes > 0 || row.resale_royalties_kes > 0);

    // Revenue-over-time: bucket by day for the primary+resale transactions we have.
    const byDay = {};
    for (const t of [...primarySales, ...royalties]) {
      const day = t.created_at.slice(0, 10);
      byDay[day] = byDay[day] || { date: day, primary: 0, resale: 0 };
      if (t.type === "primary_sale") byDay[day].primary += t.gross;
      else byDay[day].resale += t.net;
    }
    const revenueOverTime = Object.values(byDay).sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      wallet: { onlinePending: wallet.pending, availableBalance: wallet.available, totalPaidOut: wallet.totalPaidOut, minPayoutKes: MIN_WITHDRAWAL_KES },
      totals: { totalRevenue, chaintixFee, scanningFees, yourEarnings, ticketsSold: primarySales.length },
      royaltyIncome: { resaleCount: royalties.length, grossResaleValue: royalties.reduce((s, t) => s + t.resale_price_kes, 0), royaltyEarned },
      perEventBreakdown: perEvent,
      revenueOverTime,
    };
  },

  getTicketCentral: async ({ eventId, status, query } = {}) => {
    requireUser();
    await delay(350);
    let rows = db.tickets.map(ticketCentralRow);
    if (eventId) rows = rows.filter((r) => r.event_id === eventId);
    if (status) rows = rows.filter((r) => r.status === status);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => r.ticket_id.toLowerCase().includes(q) || r.event_title?.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => new Date(b.purchased_at || 0) - new Date(a.purchased_at || 0));
  },

  auditLookup: async (query) => {
    requireUser();
    await delay(350);
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches = db.tickets.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      const owner = findUserById(t.owner_id);
      if (owner?.phone_number.includes(q.replace(/\D/g, ""))) return true;
      const payment = db.payments.find((p) => p.ticket_id === t.id);
      if (payment?.mpesa_receipt_number?.toLowerCase() === q) return true;
      return false;
    });
    return matches.map(ticketCentralRow);
  },

  getCrowdControl: async (eventId) => {
    requireUser();
    await delay(300);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    const capacity = event.tiers.reduce((s, t) => s + t.capacity, 0);
    const admissions = db.admissions.filter((a) => a.event_id === eventId);
    const admitted = admissions.filter((a) => a.result === "granted").length;
    const denied = admissions.filter((a) => a.result === "denied").length;

    const byGate = {};
    for (const a of admissions) {
      const gate = event.gates.find((g) => g.id === a.gate_id);
      const key = gate?.name || "Unassigned";
      byGate[key] = byGate[key] || { gate: key, admitted: 0, denied: 0 };
      byGate[key][a.result === "granted" ? "admitted" : "denied"] += 1;
    }

    const gatesStatus = event.gates.map((g) => {
      const scanner = db.gateScanners.find((s) => s.gate_id === g.id && s.event_id === eventId);
      return {
        gate_id: g.id,
        gate_name: g.name,
        online: scanner?.status === "active",
        last_sync_at: scanner?.last_sync_at || null,
        cached_tickets: db.tickets.filter((t) => t.event_id === eventId).length,
      };
    });

    return {
      event_title: event.title,
      capacity,
      admitted,
      denied,
      admissionRate: admitted + denied ? Math.round((admitted / (admitted + denied)) * 100) : 0,
      throughputByGate: Object.values(byGate),
      gates: gatesStatus,
      queueEstimate: Math.max(0, Math.round((capacity - admitted) * 0.02)), // rough heuristic, not a real queueing model
    };
  },

  submitManualOverride: async ({ eventId, ticketId, reason }) => {
    const userId = requireUser();
    await delay(400);
    const ticket = db.tickets.find((t) => t.id === ticketId && t.event_id === eventId);
    if (!ticket) throw new ApiError("Ticket not found for this event.", 404);
    if (!reason?.trim()) throw new ApiError("A reason is required for a manual override.", 400);

    ticket.status = "used";
    ticket.used_at = new Date().toISOString();
    db.admissions.push({ id: uuid(), ticket_id: ticketId, event_id: eventId, gate_id: null, scanner_id: null, result: "granted", reason: `Manual override: ${reason}`, scanned_at: ticket.used_at });
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "manual_override", target_id: ticketId, target_type: "ticket", reason, at: new Date().toISOString() });
    save();
    return { success: true };
  },

  getScannerDevices: async () => {
    requireUser();
    await delay(250);
    return db.gateScanners.map((s) => {
      const event = db.events.find((e) => e.id === s.event_id);
      const gate = event?.gates.find((g) => g.id === s.gate_id);
      const scans = db.admissions.filter((a) => a.scanner_id === s.id);
      return {
        id: s.id,
        device_name: s.device_name,
        event_title: event?.title,
        gate_name: gate?.name,
        operator_phone_masked: s.operator_phone ? maskedPhoneFor(Object.values(db.users).find((u) => u.phone_number === s.operator_phone)?.id) : null,
        status: s.status,
        last_sync_at: s.last_sync_at,
        tickets_cached: event ? db.tickets.filter((t) => t.event_id === event.id).length : 0,
        total_scans: scans.length,
        invalid_attempts: scans.filter((a) => a.result === "denied").length,
      };
    });
  },

  inviteScanner: async ({ eventId, gateId, gateName, deviceName, operatorPhone }) => {
    requireUser();
    await delay(400);
    const event = db.events.find((e) => e.id === eventId);
    const resolvedGateId = gateId || event?.gates.find((g) => g.name === gateName)?.id;
    const scanner = {
      id: uuid(),
      event_id: eventId,
      gate_id: resolvedGateId,
      device_name: deviceName,
      operator_phone: operatorPhone,
      status: "invited",
      last_sync_at: null,
      created_at: new Date().toISOString(),
    };
    db.gateScanners.push(scanner);
    save();
    // Simulate the operator accepting the invite and syncing shortly after.
    setTimeout(() => {
      const s = db.gateScanners.find((x) => x.id === scanner.id);
      if (s) {
        s.status = "active";
        s.last_sync_at = new Date().toISOString();
        save();
      }
    }, 2500);
    return scanner;
  },

  revokeScanner: async (scannerId) => {
    requireUser();
    await delay(300);
    const s = db.gateScanners.find((x) => x.id === scannerId);
    if (!s) throw new ApiError("Scanner not found", 404);
    s.status = "revoked";
    save();
    return { success: true };
  },

  getContractStatus: async (eventId) => {
    requireUser();
    await delay(300);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    const eventTickets = db.tickets.filter((t) => t.event_id === eventId);
    const minted = eventTickets.filter((t) => t.nft_token_id);
    const pending = eventTickets.filter((t) => t.chain_status === "pending");
    return {
      event_title: event.title,
      contract_address: mockContractAddress(event.id),
      network: "Base Sepolia",
      deployed_at: event.created_at,
      resale_cap_percent: Math.round(event.resale.ceilingMultiplier * 100),
      royalty_percent: event.resale.royaltyPercent,
      total_minted: minted.length,
      mint_success_rate: eventTickets.length ? Math.round((minted.length / eventTickets.length) * 100) : 100,
      avg_gas_cost_usd: 0.018,
      failed_mint_queue: [], // nothing fails to mint in this simulation
      pending_mints: pending.length,
    };
  },

  getRoyaltyLedger: async () => {
    requireUser();
    await delay(300);
    return db.organiserWalletTransactions
      .filter((t) => t.type === "royalty")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((t) => {
        const event = db.events.find((e) => e.id === t.event_id);
        const listing = db.listings.find((l) => l.id === t.listing_id);
        return {
          id: t.id,
          date: t.created_at,
          event_title: event?.title,
          ticket_id: listing?.ticket_id,
          resale_price_kes: t.resale_price_kes,
          royalty_kes: t.net,
          tx_hash: t.tx_hash,
          status: "success",
        };
      });
  },

  getResaleCompliance: async () => {
    requireUser();
    await delay(300);
    const rejected = db.rejectedListingAttempts.length;
    const pausedByCapChange = db.listings.filter((l) => l.status === "paused" && l.pause_reason?.includes("organiser reduced")).length;
    const distribution = db.listings
      .filter((l) => ["active", "sold", "paused"].includes(l.status))
      .map((l) => {
        const event = db.events.find((e) => e.id === l.event_id);
        const tier = event?.tiers.find((t) => t.id === l.tier_id);
        return { price: l.price, face_value: tier?.price || 0 };
      });
    return { rejectedAboveCapAttempts: rejected, listingsPausedByCapChange: pausedByCapChange, priceDistribution: distribution };
  },

  // ── Platform Admin (spec.md §7) ──────────────────────────────────────────
  // Same "no multi-tenant model" reality noted on Organiser Console above,
  // but here it's simply correct: Admin is meant to see every organiser and
  // event on the platform, not a scoped subset.

  getPlatformDashboard: async () => {
    requireUser();
    await delay(300);
    const primarySales = db.organiserWalletTransactions.filter((t) => t.type === "primary_sale");
    const resoldGmv = db.listings.filter((l) => l.status === "sold").reduce((s, l) => s + l.price, 0);
    const gmv = primarySales.reduce((s, t) => s + t.gross, 0) + resoldGmv;
    const platformFeeRevenue = primarySales.reduce((s, t) => s + t.chaintix_fee, 0);
    const activeEvents = db.events.filter((e) => e.status === "live" || e.status === "sold_out").length;
    const todayStr = new Date().toDateString();
    const ticketsSoldToday = db.tickets.filter((t) => t.purchased_at && !t.is_complimentary && new Date(t.purchased_at).toDateString() === todayStr).length;
    return {
      gmv,
      activeEvents,
      ticketsSoldToday,
      platformFeeRevenue,
      organiserCount: db.platformOrganisers.length,
      failedMintCount: 0, // nothing fails to mint in this simulation — see Contract Status
      payoutQueueDepth: computePayoutQueueDepth(),
    };
  },

  getPlatformOrganisers: async () => {
    requireUser();
    await delay(300);
    return db.platformOrganisers.slice().sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
  },

  reviewOrganiser: async ({ id, decision, reason }) => {
    const userId = requireUser();
    await delay(400);
    const org = db.platformOrganisers.find((o) => o.id === id);
    if (!org) throw new ApiError("Organiser not found", 404);
    if (!["verified", "rejected"].includes(decision)) throw new ApiError("Invalid decision", 400);
    org.status = decision;
    org.review_reason = reason || null;
    org.reviewed_at = new Date().toISOString();
    db.auditLog.push({ id: uuid(), actor_id: userId, action: `organiser_${decision}`, target_id: id, target_type: "organiser", reason: reason || null, at: org.reviewed_at });
    save();
    return { success: true };
  },

  suspendOrganiser: async ({ id, reason }) => {
    const userId = requireUser();
    await delay(400);
    const org = db.platformOrganisers.find((o) => o.id === id);
    if (!org) throw new ApiError("Organiser not found", 404);
    if (!reason?.trim()) throw new ApiError("A reason is required to suspend an account.", 400);
    org.status = "suspended";
    org.suspended_reason = reason;
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "organiser_suspended", target_id: id, target_type: "organiser", reason, at: new Date().toISOString() });
    save();
    return { success: true };
  },

  reinstateOrganiser: async (id) => {
    const userId = requireUser();
    await delay(400);
    const org = db.platformOrganisers.find((o) => o.id === id);
    if (!org) throw new ApiError("Organiser not found", 404);
    org.status = "verified";
    org.suspended_reason = null;
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "organiser_reinstated", target_id: id, target_type: "organiser", at: new Date().toISOString() });
    save();
    return { success: true };
  },

  getEventApprovalQueue: async () => {
    requireUser();
    await delay(300);
    return db.events
      .filter((e) => e.status === "draft")
      .map((e) => {
        const capacity = e.total_capacity || e.tiers.reduce((s, t) => s + t.capacity, 0);
        const checks = [
          { label: "Has a cover image", pass: Boolean(e.image_data_url) },
          { label: "Has a description", pass: (e.description_html || e.description || "").replace(/<[^>]+>/g, "").trim().length > 20 },
          { label: "Has at least one ticket tier", pass: e.tiers.length > 0 },
          { label: "Capacity is set", pass: capacity > 0 },
          { label: "Resale cap within policy (≤200%)", pass: !e.resale.resaleEnabled || e.resale.ceilingMultiplier <= 2 },
        ];
        return {
          id: e.id,
          title: e.title,
          venue: e.venue,
          category: e.category,
          event_date: e.event_date,
          image_data_url: e.image_data_url,
          description: e.description_html || e.description,
          capacity,
          tiers: e.tiers.map((t) => ({ name: t.name, price: t.price, capacity: t.capacity })),
          submitted_at: e.created_at,
          checks,
          allPassed: checks.every((c) => c.pass),
        };
      })
      .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  },

  approveEvent: async (eventId) => {
    const userId = requireUser();
    await delay(400);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    event.status = "live";
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "event_approved", target_id: eventId, target_type: "event", at: new Date().toISOString() });
    save();
    return { success: true };
  },

  rejectEvent: async ({ eventId, reason }) => {
    const userId = requireUser();
    await delay(400);
    const event = db.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("Event not found", 404);
    if (!reason?.trim()) throw new ApiError("A reason is required to reject an event.", 400);
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "event_rejected", target_id: eventId, target_type: "event", reason, at: new Date().toISOString() });
    save();
    return { success: true };
  },

  getPlatformCosts: async () => {
    requireUser();
    await delay(300);
    const INFRA_MONTHLY_USD = 420;
    const GAS_PER_MINT_USD = 0.018;
    const SMS_PER_TICKET_KES = 1.5;
    const DARAJA_PER_TXN_KES = 12;

    const mintedCount = db.tickets.filter((t) => t.nft_token_id).length;
    const paidTicketCount = db.tickets.filter((t) => !t.is_complimentary).length;
    const paymentCount = db.payments.filter((p) => p.status === "success").length;

    const perEvent = db.events
      .map((e) => {
        const eventTickets = db.tickets.filter((t) => t.event_id === e.id);
        const minted = eventTickets.filter((t) => t.nft_token_id).length;
        const revenue = db.organiserWalletTransactions.filter((t) => t.event_id === e.id && t.type === "primary_sale").reduce((s, t) => s + t.gross, 0);
        const paidTickets = eventTickets.filter((t) => !t.is_complimentary).length;
        return {
          event_id: e.id,
          event_title: e.title,
          tickets_sold: eventTickets.length,
          revenue_kes: revenue,
          gas_cost_usd: Math.round(minted * GAS_PER_MINT_USD * 100) / 100,
          sms_cost_kes: Math.round(paidTickets * SMS_PER_TICKET_KES),
        };
      })
      .filter((row) => row.tickets_sold > 0)
      .sort((a, b) => b.revenue_kes - a.revenue_kes);

    return {
      infraMonthlyUsd: INFRA_MONTHLY_USD,
      gasSpendUsd: Math.round(mintedCount * GAS_PER_MINT_USD * 100) / 100,
      smsSpendKes: Math.round(paidTicketCount * SMS_PER_TICKET_KES),
      darajaChargesKes: Math.round(paymentCount * DARAJA_PER_TXN_KES),
      perEvent,
    };
  },

  getFeeConfig: async () => {
    requireUser();
    await delay(200);
    return { current: { ...db.platformFeeConfig }, history: db.platformFeeConfigHistory.slice().sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at)) };
  },

  /** Persists and audits real config changes — display/config values only.
   * Not wired back to the fixed PLATFORM_FEE_PERCENT/SCANNING_FEE_PER_TICKET_KES/
   * MIN_WITHDRAWAL_KES constants those other screens compute against yet;
   * doing that is Phase 3 backend work, same caveat as devCutResaleCap. */
  updateFeeConfig: async (payload) => {
    const userId = requireUser();
    await delay(400);
    const before = { ...db.platformFeeConfig };
    const after = { ...db.platformFeeConfig, ...payload, effectiveFrom: new Date().toISOString() };
    db.platformFeeConfig = after;
    db.platformFeeConfigHistory.unshift({ id: uuid(), actor_id: userId, before, after, changed_at: after.effectiveFrom });
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "fee_config_updated", target_id: "platform_fee_config", target_type: "config", at: after.effectiveFrom });
    save();
    return { success: true, current: after };
  },

  getPayoutQueue: async () => {
    requireUser();
    await delay(300);
    const now = Date.now();
    const sellerRows = db.walletTransactions
      .filter((t) => t.available_at && new Date(t.available_at).getTime() > now)
      .map((t) => ({ id: t.id, type: "seller", recipient: maskedPhoneFor(t.user_id), description: t.description, amount_kes: t.amount, available_at: t.available_at }));
    const organiserRows = db.organiserWalletTransactions
      .filter((t) => t.available_at && new Date(t.available_at).getTime() > now)
      .map((t) => {
        const event = db.events.find((e) => e.id === t.event_id);
        return { id: t.id, type: "organiser", recipient: event?.title || "Organiser", description: t.description, amount_kes: t.net, available_at: t.available_at };
      });
    return [...sellerRows, ...organiserRows].sort((a, b) => new Date(a.available_at) - new Date(b.available_at));
  },

  getPlatformResaleCompliance: async () => {
    requireUser();
    await delay(300);
    const byEvent = db.events
      .map((e) => {
        const rejected = db.rejectedListingAttempts.filter((r) => r.event_id === e.id).length;
        const listings = db.listings.filter((l) => l.event_id === e.id && ["active", "sold", "paused"].includes(l.status)).length;
        return { event_id: e.id, event_title: e.title, rejected, listings, cap_percent: Math.round(e.resale.ceilingMultiplier * 100) };
      })
      .filter((row) => row.rejected > 0 || row.listings > 0);
    return {
      rejectedAboveCapAttempts: db.rejectedListingAttempts.length,
      listingsPausedByCapChange: db.listings.filter((l) => l.status === "paused" && l.pause_reason?.includes("organiser reduced")).length,
      byEvent,
    };
  },

  getFraudSignals: async () => {
    requireUser();
    await delay(300);
    return computeFraudSignals();
  },

  getBroadcastChannels: async () => ({
    in_app: { available: true, reason: null },
    sms: { available: true, reason: null },
    push: { available: true, reason: null },
  }),

  getAnnouncements: async () => {
    const now = Date.now();
    return db.platformBroadcasts
      .filter((b) => b.channels.includes("in_app") && (!b.scheduled_for || new Date(b.scheduled_for).getTime() <= now))
      .slice(0, 3)
      .map((b) => ({ id: b.id, message: b.message, at: b.sent_at || b.scheduled_for }));
  },

  exportAuditLog: async () => {
    requireUser();
    await delay(300);
    return { success: true };
  },

  getBroadcasts: async () => {
    requireUser();
    await delay(250);
    return db.platformBroadcasts.slice().sort((a, b) => new Date(b.sent_at || b.scheduled_for) - new Date(a.sent_at || a.scheduled_for));
  },

  sendBroadcast: async ({ message, channels, audience, scheduledFor }) => {
    const userId = requireUser();
    await delay(500);
    if (!message?.trim()) throw new ApiError("Message can't be empty.", 400);
    if (!channels?.length) throw new ApiError("Pick at least one channel.", 400);

    const audienceSize = {
      all: Object.keys(db.users).length + db.platformOrganisers.length,
      attendees: Object.keys(db.users).length,
      organisers: db.platformOrganisers.length,
      gate_staff: db.gateScanners.length,
    }[audience] || 0;

    const DELIVERY_RATE = { sms: 0.97, push: 0.82, in_app: 0.99 };
    const delivery = {};
    for (const ch of channels) delivery[ch] = { sent: audienceSize, delivered: Math.round(audienceSize * (DELIVERY_RATE[ch] ?? 0.9)) };

    const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
    const broadcast = {
      id: uuid(),
      message,
      channels,
      audience,
      audience_size: audienceSize,
      status: isScheduled ? "scheduled" : "sent",
      scheduled_for: scheduledFor || null,
      sent_at: isScheduled ? null : new Date().toISOString(),
      delivery,
      created_by: userId,
    };
    db.platformBroadcasts.unshift(broadcast);
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "broadcast_sent", target_id: broadcast.id, target_type: "broadcast", at: new Date().toISOString() });
    save();
    return broadcast;
  },

  getAuditLog: async ({ query } = {}) => {
    requireUser();
    await delay(300);
    let rows = db.auditLog.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((r) => [r.action, r.target_id, r.target_type, r.reason].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
    }
    return rows.map((r) => ({ ...r, actor_phone_masked: maskedPhoneFor(r.actor_id) }));
  },

  getAdminUsers: async () => {
    requireUser();
    await delay(250);
    return db.adminUsers.slice();
  },

  inviteAdminUser: async ({ name, phone, role }) => {
    const userId = requireUser();
    await delay(350);
    const admin = { id: uuid(), name, phone, role, status: "invited", invited_at: new Date().toISOString() };
    db.adminUsers.push(admin);
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "admin_user_invited", target_id: admin.id, target_type: "admin_user", at: admin.invited_at });
    save();
    return admin;
  },

  removeAdminUser: async (id) => {
    const userId = requireUser();
    await delay(250);
    db.adminUsers = db.adminUsers.filter((a) => a.id !== id);
    db.auditLog.push({ id: uuid(), actor_id: userId, action: "admin_user_removed", target_id: id, target_type: "admin_user", at: new Date().toISOString() });
    save();
    return { success: true };
  },

  getAdminNotifications: async () => {
    requireUser();
    await delay(250);
    const notices = [];
    const pendingOrganisers = db.platformOrganisers.filter((o) => o.status === "pending").length;
    if (pendingOrganisers > 0) notices.push({ id: "n-organisers", severity: "info", text: `${pendingOrganisers} organiser account${pendingOrganisers === 1 ? "" : "s"} awaiting verification`, link: "/admin/organisers" });
    const pendingEvents = db.events.filter((e) => e.status === "draft").length;
    if (pendingEvents > 0) notices.push({ id: "n-events", severity: "info", text: `${pendingEvents} event${pendingEvents === 1 ? "" : "s"} awaiting approval`, link: "/admin/events" });
    const fraud = computeFraudSignals();
    const fraudCount = fraud.repeatedFailedScans.length + fraud.unusualVelocity.length + fraud.duplicateDevices.length;
    if (fraudCount > 0) notices.push({ id: "n-fraud", severity: "warning", text: `${fraudCount} fraud signal${fraudCount === 1 ? "" : "s"} flagged for review`, link: "/admin/fraud" });
    const queueDepth = computePayoutQueueDepth();
    if (queueDepth > 5) notices.push({ id: "n-payouts", severity: "info", text: `${queueDepth} payouts queued, releasing over the next few days`, link: "/admin/payouts" });
    return notices;
  },

  getFeatureFlags: async () => {
    requireUser();
    await delay(200);
    return db.featureFlags.slice();
  },

  toggleFeatureFlag: async (id) => {
    const userId = requireUser();
    await delay(300);
    const flag = db.featureFlags.find((f) => f.id === id);
    if (!flag) throw new ApiError("Flag not found", 404);
    flag.enabled = !flag.enabled;
    flag.rollout_percent = flag.enabled ? (flag.rollout_percent || 100) : 0;
    db.auditLog.push({ id: uuid(), actor_id: userId, action: flag.enabled ? "feature_flag_enabled" : "feature_flag_disabled", target_id: id, target_type: "feature_flag", at: new Date().toISOString() });
    save();
    return { ...flag };
  },

  updateFeatureFlagRollout: async ({ id, rolloutPercent }) => {
    requireUser();
    await delay(300);
    const flag = db.featureFlags.find((f) => f.id === id);
    if (!flag) throw new ApiError("Flag not found", 404);
    flag.rollout_percent = Math.max(0, Math.min(100, rolloutPercent));
    flag.enabled = flag.rollout_percent > 0;
    save();
    return { ...flag };
  },
};
