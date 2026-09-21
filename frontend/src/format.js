export function formatKES(amount) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount);
}

export function formatEventDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short" });
}

/** Loose Kenyan mobile validation — 07XXXXXXXX / 01XXXXXXXX / 2547.../2541... / +254... */
export function isValidKenyanPhone(input) {
  const digits = String(input).replace(/\D/g, "");
  return /^(?:254|0)(7|1)\d{8}$/.test(digits);
}

/** Normalizes any accepted input shape to 2547XXXXXXXX (API/storage format). */
export function normalizeKenyanPhone(input) {
  let digits = String(input).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  else if (!digits.startsWith("254")) digits = "254" + digits;
  return digits;
}

function phoneGroups(phone) {
  // Accepts 2547XXXXXXXX (API/storage format) or 07XXXXXXXX — normalizes to
  // local "07.." then groups as 4-3-3, matching spec §8.2's "0712 345 678".
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("254")) digits = "0" + digits.slice(3);
  if (digits.length !== 10) return null;
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)];
}

/** 254712345678 -> "0712 345 678" — spec §8.2. */
export function formatPhone(phone) {
  const g = phoneGroups(phone);
  return g ? g.join(" ") : phone;
}

/** 254712345678 -> "07** *** 678" — spec §8.2: shown wherever an operator/organiser sees someone else's number. */
export function maskPhone(phone) {
  const g = phoneGroups(phone);
  if (!g) return phone;
  return [g[0].slice(0, 2) + "**", "***", g[2]].join(" ");
}
