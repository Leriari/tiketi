// Pure TOTP math (RFC 6238) via Web Crypto's HMAC-SHA1 — no store access, no
// network, no I/O of any kind. Matches app/services/totp_service.py exactly:
// base32 secret, 30-second step, 6 digits, SHA-1. Async because
// crypto.subtle is promise-based, not because this calls anywhere — the
// work order's rule is "no network call," not "no asynchrony."

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

/** RFC 4648 base32 decode. Written by hand rather than adding a dependency
 * for ~15 lines of bit-shifting — this is the one place a round-trip bug
 * would silently corrupt every single validation, so it's covered directly
 * by tests in validate.offline.test.js via known secret/code pairs. */
export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, "").trim();
  let bits = "";
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const byteCount = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

function counterToBytes(counter) {
  // 8-byte big-endian counter. `counter` is unix_time/30 — safely within
  // 32 bits for the lifetime of this project, so only the low 4 bytes are
  // ever non-zero, but the full 8-byte buffer is what HOTP (RFC 4226) specifies.
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter, false);
  return buf;
}

/** HOTP(secret, counter) -> 6-digit code, per RFC 4226. */
async function hotp(secretBytes, counter) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBytes(counter)));

  const offset = signature[signature.length - 1] & 0x0f;
  const binCode =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binCode % 1_000_000).padStart(6, "0");
}

/** The code for a base32 secret at a specific unix-second timestamp. */
export async function computeTotp(secretBase32, unixSeconds) {
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  return hotp(secretBytes, counter);
}

/** Current window plus one either side — matches
 * app/services/totp_service.py's verify_otp(valid_window=1) exactly: a
 * 90-second acceptance range, to tolerate a steward's device clock drifting
 * against the phone that generated the code. */
export async function verifyTotp(secretBase32, otp, { nowSeconds } = {}) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  for (const deltaSteps of [0, -1, 1]) {
    const candidate = await computeTotp(secretBase32, now + deltaSteps * TOTP_STEP_SECONDS);
    if (candidate === otp) return true;
  }
  return false;
}
