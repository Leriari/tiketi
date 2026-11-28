// Tickets saved on this phone, so the ticket screen and its QR code work
// at a gate with no signal. Holds the ticket list, each opened ticket's
// details, and each active ticket's QR secret (the same secret the server
// already hands this phone through GET /tickets/{id}/seed). The QR code
// itself is computed from the secret on the phone (scanner/totp.js).
//
// One account per device: saving for a different account replaces what's
// here. Logging out clears it (AuthContext.logout). An expired session does
// not, because the ticket is still the holder's and the gate may have no
// signal to sign in again.
const KEY = "chaintix_offline_tickets";

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return value && typeof value === "object" && value.tickets ? value : null;
  } catch {
    return null;
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked (private mode): the app still works online.
  }
}

// For saving: this account's store, or a fresh one.
function storeFor(userId) {
  const store = read();
  if (store && store.userId === userId) return store;
  return { userId, tickets: {}, list: null, listSavedAt: null };
}

// For reading: a signed-in user sees only their own saved tickets. With no
// session (it expired while offline), whatever this device saved is shown.
function readable(userId) {
  const store = read();
  if (!store) return null;
  if (userId && store.userId !== userId) return null;
  return store;
}

/** The "My tickets" list as the server last sent it. Drops saved tickets
 * that are no longer this account's, and the QR secret of any that are no
 * longer active (used, listed for resale, cancelled). */
export function saveTicketList(userId, list) {
  if (!userId) return;
  const store = storeFor(userId);
  const byId = new Map(list.map((t) => [t.id, t]));
  for (const id of Object.keys(store.tickets)) {
    const current = byId.get(id);
    if (!current) delete store.tickets[id];
    else if (current.status !== "active") delete store.tickets[id].secret;
  }
  store.list = list;
  store.listSavedAt = new Date().toISOString();
  write(store);
}

export function savedTicketList(userId) {
  const store = readable(userId);
  return store?.list ? { tickets: store.list, savedAt: store.listSavedAt } : null;
}

/** Save a ticket's details and/or its QR secret. Details that say the
 * ticket isn't active remove its secret. */
export function saveTicket(userId, ticketId, { detail, secret } = {}) {
  if (!userId) return;
  const store = storeFor(userId);
  const entry = store.tickets[ticketId] || {};
  if (detail) {
    entry.detail = detail;
    entry.savedAt = new Date().toISOString();
    if (detail.status !== "active") delete entry.secret;
  }
  if (secret && (entry.detail?.status ?? "active") === "active") entry.secret = secret;
  store.tickets[ticketId] = entry;
  write(store);
}

/** { detail, secret, savedAt } for a saved ticket, or null. A ticket that
 * was only ever seen in the list gets its details from the list entry. */
export function savedTicket(userId, ticketId) {
  const store = readable(userId);
  if (!store) return null;
  const entry = store.tickets[ticketId];
  let detail = entry?.detail;
  if (!detail) {
    const item = store.list?.find((t) => t.id === ticketId);
    if (item) detail = { ...item, ticket_id: item.id, gate_assignment: item.gate_name };
  }
  if (!detail) return null;
  return { detail, secret: entry?.secret || null, savedAt: entry?.savedAt || store.listSavedAt };
}

export function forgetTicketSecret(userId, ticketId) {
  const store = readable(userId);
  if (!store?.tickets[ticketId]) return;
  delete store.tickets[ticketId].secret;
  write(store);
}

/** The ticket isn't this account's any more (sold, given away). */
export function forgetTicket(userId, ticketId) {
  const store = readable(userId);
  if (!store) return;
  delete store.tickets[ticketId];
  if (store.list) store.list = store.list.filter((t) => t.id !== ticketId);
  write(store);
}

export function hasSavedTickets() {
  const store = read();
  return Boolean(store && (store.list?.length || Object.keys(store.tickets).length));
}

export function clearSavedTickets() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing saved, or storage blocked
  }
}
