"""
TOTP (Time-based One-Time Password) service for dynamic QR codes.

Each ticket gets a unique base32 secret seed.
The seed + current 30-second time window produces a 6-digit OTP.
The QR code encodes: "TIKETI:<ticket_id>:<otp>"

This means:
  - Screenshots are useless (code changes every 30s)
  - No internet required at the gate (pure math + device clock)
  - The gate's local server independently computes the valid OTP
    and rejects anything that doesn't match
"""
import secrets
import base64
import pyotp
import qrcode
import io
from datetime import datetime, timezone


TOTP_INTERVAL = 30  # seconds per window


def generate_totp_secret() -> str:
    """Generate a cryptographically secure random base32 secret seed."""
    # 20 random bytes → base32 encoded = 32-char secret (160-bit entropy)
    random_bytes = secrets.token_bytes(20)
    return base64.b32encode(random_bytes).decode("utf-8")


def get_totp(secret: str) -> pyotp.TOTP:
    """Return a TOTP object for a given secret."""
    return pyotp.TOTP(secret, interval=TOTP_INTERVAL)


def generate_current_otp(secret: str) -> str:
    """Get the current 6-digit OTP for a ticket secret."""
    return get_totp(secret).now()


def verify_otp(secret: str, otp: str, valid_window: int = 1) -> bool:
    """
    Verify an OTP against the secret.
    valid_window=1 allows ±1 interval (±30s) to account for clock drift
    between the user's phone and the gate's local server.
    """
    return get_totp(secret).verify(otp, valid_window=valid_window)


def build_qr_payload(ticket_id: str, secret: str) -> str:
    """
    Build the string that gets encoded in the QR.
    Format: TIKETI:<ticket_id>:<current_otp>
    The gate scanner extracts ticket_id, looks up the secret,
    and independently verifies the OTP.
    """
    current_otp = generate_current_otp(secret)
    return f"TIKETI:{ticket_id}:{current_otp}"


def generate_qr_image_bytes(ticket_id: str, secret: str) -> bytes:
    """
    Generate a QR code PNG image in memory.
    Returns raw bytes suitable for sending as an HTTP response.
    Used by the ticket viewer endpoint.
    """
    payload = build_qr_payload(ticket_id, secret)

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # high redundancy
        box_size=10,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def seconds_until_next_rotation() -> int:
    """How many seconds until the current TOTP window expires."""
    return TOTP_INTERVAL - (int(datetime.now(timezone.utc).timestamp()) % TOTP_INTERVAL)


# ─── Gate Validation (used by local mesh server) ──────────────────────────────

def validate_scanned_payload(payload: str, secret: str) -> tuple[bool, str]:
    """
    Parse and validate a scanned QR payload.

    Returns:
        (is_valid: bool, reason: str)
    """
    try:
        parts = payload.split(":")
        if len(parts) != 3 or parts[0] != "TIKETI":
            return False, "Invalid QR format"

        _, ticket_id, scanned_otp = parts

        if not verify_otp(secret, scanned_otp):
            return False, "OTP expired or invalid"

        return True, ticket_id

    except Exception as e:
        return False, f"Validation error: {str(e)}"
