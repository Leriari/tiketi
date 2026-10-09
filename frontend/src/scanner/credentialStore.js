// The Scanner's on-device store (Work Order 03, A4) — IndexedDB, not
// localStorage. localStorage is synchronous, string-only, and capped around
// 5MB; a few thousand TOTP-secret records plus an admissions log is the
// wrong shape for it. This module owns ONLY local persistence — it never
// calls the network. Syncing (pulling credentials in) and uploading
// (pushing scan results out) are separate concerns that live in the page
// components and call the real API; this file doesn't know either exists.
//
// Two object stores:
//   - credentials: one row per synced ticket, keyed by ticket id
//   - admissions:  one row per ticket already granted entry ON THIS DEVICE,
//                  keyed by ticket id — this is both the double-scan check
//                  (validate.js reads it) and the upload queue for Block B's
//                  reconciliation (rows start `uploaded: false`)
//
// Sync metadata (which event/gate this device is synced to, when, etc.) is a
// single small object, not bulk data, so it stays in localStorage rather
// than adding a third IndexedDB store for one object.

const DB_NAME = "tiketi_scanner";
const DB_VERSION = 1;
const CREDENTIALS_STORE = "credentials";
const ADMISSIONS_STORE = "admissions";
const META_KEY = "tiketi_scanner_meta";
const DEVICE_ID_KEY = "tiketi_scanner_device_id";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CREDENTIALS_STORE)) {
        db.createObjectStore(CREDENTIALS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ADMISSIONS_STORE)) {
        db.createObjectStore(ADMISSIONS_STORE, { keyPath: "ticket_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Device identity ──────────────────────────────────────────────────────

export function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ── Sync metadata (one small object, localStorage is fine here) ─────────

export function getMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta;
}

// ── Credentials ───────────────────────────────────────────────────────────

/** Replaces the entire credential set with a fresh sync payload. */
export async function replaceCredentials(tickets) {
  const db = await openDb();
  const store = tx(db, CREDENTIALS_STORE, "readwrite");
  await promisifyRequest(store.clear());
  for (const t of tickets) {
    store.put(t);
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(tickets.length);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getCredential(ticketId) {
  const db = await openDb();
  return promisifyRequest(tx(db, CREDENTIALS_STORE, "readonly").get(ticketId));
}

export async function countCredentials() {
  const db = await openDb();
  return promisifyRequest(tx(db, CREDENTIALS_STORE, "readonly").count());
}

// ── Admissions (double-scan check + Block B upload queue) ──────────────────

export async function getAdmission(ticketId) {
  const db = await openDb();
  return promisifyRequest(tx(db, ADMISSIONS_STORE, "readonly").get(ticketId));
}

/** Written BEFORE the verdict is returned to the caller (validate.js), so a
 * double-scan a moment later is caught even without a round-trip anywhere. */
export async function recordAdmission(ticketId, scannedAt) {
  const db = await openDb();
  const store = tx(db, ADMISSIONS_STORE, "readwrite");
  store.put({ ticket_id: ticketId, scanned_at: scannedAt, uploaded: false });
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getAllAdmissions() {
  const db = await openDb();
  return promisifyRequest(tx(db, ADMISSIONS_STORE, "readonly").getAll());
}

export async function countPendingUpload() {
  const all = await getAllAdmissions();
  return all.filter((a) => !a.uploaded).length;
}

export async function markAdmissionsUploaded(ticketIds) {
  const db = await openDb();
  const store = tx(db, ADMISSIONS_STORE, "readwrite");
  for (const id of ticketIds) {
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result;
      if (row) store.put({ ...row, uploaded: true });
    };
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

// ── Wipe ──────────────────────────────────────────────────────────────────

/** Clears both IndexedDB stores and the sync metadata. Raw TOTP secrets
 * sitting indefinitely on a steward's personal phone are the most sensitive
 * data this system holds — this is called explicitly ("End session") and
 * automatically once the synced event is long over (see maybeAutoWipe). */
export async function wipeAll() {
  const db = await openDb();
  await Promise.all([
    promisifyRequest(tx(db, CREDENTIALS_STORE, "readwrite").clear()),
    promisifyRequest(tx(db, ADMISSIONS_STORE, "readwrite").clear()),
  ]);
  localStorage.removeItem(META_KEY);
}

/** Auto-wipe once the synced event is well over. A fixed 24h grace period
 * past the event's start time — this schema has no explicit end time/date,
 * so this is a deliberate buffer for an event that runs late, not a precise
 * end-of-event signal. Call on app load. */
export async function maybeAutoWipe() {
  const meta = getMeta();
  if (!meta?.event_date) return false;
  const wipeAfter = new Date(meta.event_date).getTime() + 24 * 60 * 60 * 1000;
  if (Date.now() > wipeAfter) {
    await wipeAll();
    return true;
  }
  return false;
}
