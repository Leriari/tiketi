"""Tests for TOTP / dynamic QR code logic."""
import time
import pytest
from app.services.totp_service import (
    generate_totp_secret,
    generate_current_otp,
    verify_otp,
    build_qr_payload,
    validate_scanned_payload,
    generate_qr_image_bytes,
    seconds_until_next_rotation,
)


def test_generate_totp_secret_format():
    secret = generate_totp_secret()
    assert len(secret) == 32
    # Must be valid base32
    import base64
    base64.b32decode(secret)


def test_totp_secrets_are_unique():
    secrets = {generate_totp_secret() for _ in range(100)}
    assert len(secrets) == 100


def test_current_otp_is_6_digits():
    secret = generate_totp_secret()
    otp = generate_current_otp(secret)
    assert len(otp) == 6
    assert otp.isdigit()


def test_verify_otp_valid():
    secret = generate_totp_secret()
    otp = generate_current_otp(secret)
    assert verify_otp(secret, otp) is True


def test_verify_otp_wrong_code():
    secret = generate_totp_secret()
    assert verify_otp(secret, "000000") is False


def test_verify_otp_wrong_secret():
    secret1 = generate_totp_secret()
    secret2 = generate_totp_secret()
    otp = generate_current_otp(secret1)
    assert verify_otp(secret2, otp) is False


def test_qr_payload_format():
    secret = generate_totp_secret()
    ticket_id = "test-ticket-123"
    payload = build_qr_payload(ticket_id, secret)

    parts = payload.split(":")
    assert parts[0] == "TIKETI"
    assert parts[1] == ticket_id
    assert len(parts[2]) == 6
    assert parts[2].isdigit()


def test_validate_scanned_payload_valid():
    secret = generate_totp_secret()
    ticket_id = "abc-123"
    payload = build_qr_payload(ticket_id, secret)

    is_valid, result = validate_scanned_payload(payload, secret)
    assert is_valid is True
    assert result == ticket_id


def test_validate_scanned_payload_bad_format():
    is_valid, reason = validate_scanned_payload("not-a-valid-qr", "secret")
    assert is_valid is False
    assert "Invalid" in reason


def test_validate_scanned_payload_wrong_prefix():
    is_valid, reason = validate_scanned_payload("OTHER:ticket-1:123456", "secret")
    assert is_valid is False


def test_validate_scanned_payload_expired_otp():
    secret = generate_totp_secret()
    payload = "TIKETI:ticket-1:000000"  # OTP 000000 almost certainly wrong
    is_valid, _ = validate_scanned_payload(payload, secret)
    assert is_valid is False


def test_qr_image_is_png():
    secret = generate_totp_secret()
    img_bytes = generate_qr_image_bytes("ticket-123", secret)
    # PNG magic bytes
    assert img_bytes[:4] == b"\x89PNG"


def test_seconds_until_rotation_range():
    secs = seconds_until_next_rotation()
    assert 0 < secs <= 30
