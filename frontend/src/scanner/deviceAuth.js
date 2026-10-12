// Scanner device-token storage (Work Order 04 B4/C3) — deliberately
// separate from auth-storage.js's user JWT. A gate device authenticates
// as itself, not as a user account, so it gets its own storage key and
// its own lifecycle (set once at enrolment, cleared only by "End session
// & clear device" or a backend-side revoke making the token stop working).
const DEVICE_KEY = "tiketi_scanner_device";

export function getDeviceInfo() {
  const raw = localStorage.getItem(DEVICE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setDeviceInfo({ deviceToken, scannerId, eventId, eventTitle, gateName }) {
  const info = { deviceToken, scannerId, eventId, eventTitle, gateName };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(info));
  return info;
}

export function clearDeviceInfo() {
  localStorage.removeItem(DEVICE_KEY);
}

export function getDeviceToken() {
  return getDeviceInfo()?.deviceToken ?? null;
}
