"""
Work Order 04 — auth hardening tests (Block A).

Reuses test_api.py's TestClient/DB setup, same reasoning as test_resale.py:
two separate engines both bound to app.dependency_overrides would fight
over which one a given test actually hits.
"""
import os
import pytest
from cryptography.fernet import Fernet

from tests.test_api import client
from app.services.auth_service import MAX_OTP_ATTEMPTS


def _request_otp(phone: str) -> str:
    res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
    assert res.status_code == 200
    return res.json()["dev_otp"]


# ── A2: single-use ───────────────────────────────────────────────────────────

def test_otp_is_single_use():
    phone = "0788000001"
    otp = _request_otp(phone)

    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200

    # Same code, replayed — must now be rejected, not accepted a second time.
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 401


# ── A2: attempt limiting ─────────────────────────────────────────────────────

def test_otp_locks_out_after_max_wrong_attempts():
    phone = "0788000002"
    otp = _request_otp(phone)

    # MAX_OTP_ATTEMPTS wrong guesses in a row.
    for _ in range(MAX_OTP_ATTEMPTS):
        res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": "000000"})
        assert res.status_code == 401

    # The real code — now locked out, must still be rejected.
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 401


def test_otp_attempt_counter_does_not_reset_on_each_wrong_guess():
    """A wrong guess must count toward the same lockout, not reset it —
    otherwise the limit is decorative."""
    phone = "0788000003"
    otp = _request_otp(phone)

    for _ in range(MAX_OTP_ATTEMPTS - 1):
        client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": "111111"})

    # One more wrong guess reaches the limit.
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": "222222"})
    assert res.status_code == 401

    # The correct code is now locked out too.
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 401


# ── A2: no account-enumeration via request-otp ───────────────────────────────

# ── A3: rate limiting ─────────────────────────────────────────────────────

def test_request_otp_rate_limited_by_phone():
    """The 6th request-otp call for the same phone within the window must
    be refused with 429, not silently served another code."""
    phone = "0788000004"
    for _ in range(5):
        res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
        assert res.status_code == 200

    res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
    assert res.status_code == 429


def test_login_rate_limited_by_phone():
    phone = "0788000005"
    for _ in range(5):
        res = client.post("/api/v1/auth/login", json={"phone_number": phone})
        assert res.status_code == 200

    res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    assert res.status_code == 429


def test_purchase_rate_limited_by_authenticated_user(monkeypatch):
    """Isolated via monkeypatch (a much lower temporary limit) rather than
    making 31 real purchase calls, and against a throwaway user/event so it
    can't dent the shared purchase budget other test modules rely on."""
    import app.api.routes.payments as payments_route
    monkeypatch.setattr(payments_route, "_PURCHASE_LIMIT", (2, 300))

    phone = "0788000006"
    login_res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    org_res = client.post("/api/v1/organisations/", json={"business_name": "Rate Limit Test Org"}, headers=headers)

    event_res = client.post("/api/v1/events/", json={
        "organization_id": org_res.json()["id"],
        "title": "Rate Limit Test Event",
        "venue": "Test Venue",
        "event_date": "2027-03-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 10,
    }, headers=headers)
    event_id = event_res.json()["id"]

    for _ in range(2):
        res = client.post("/api/v1/payments/purchase", json={
            "event_id": event_id, "phone_number": phone,
        }, headers=headers)
        assert res.status_code == 201, res.text

    res = client.post("/api/v1/payments/purchase", json={
        "event_id": event_id, "phone_number": phone,
    }, headers=headers)
    assert res.status_code == 429


def test_request_otp_response_identical_for_new_and_existing_number():
    """request-otp must not reveal whether a phone number is already
    registered — same response shape either way. A brand-new number has
    never had get_or_create_user called for it (that only happens at
    verify-otp), so this is a direct structural guarantee, not a behaviour
    that could silently regress."""
    new_phone = "0788099999"
    res_new = client.post("/api/v1/auth/request-otp", json={"phone_number": new_phone})
    assert res_new.status_code == 200
    assert set(res_new.json().keys()) == {"message", "phone_number", "dev_otp"}

    # Register the number, then request again — response shape must match.
    otp = res_new.json()["dev_otp"]
    client.post("/api/v1/auth/verify-otp", json={"phone_number": new_phone, "otp_code": otp})

    res_existing = client.post("/api/v1/auth/request-otp", json={"phone_number": new_phone})
    assert res_existing.status_code == 200
    assert set(res_existing.json().keys()) == set(res_new.json().keys())
    assert res_existing.json()["message"] == res_new.json()["message"]


# ── A5: the two fail-closed guarantees for the dev OTP inbox ────────────────
# These are what let the dissertation state the simulation cannot leak into
# a deployment: one proves the route itself refuses to serve outside
# development, the other proves the dangerous config combination can't even
# boot.

def test_otp_inbox_404s_when_not_development(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    try:
        res = client.get("/dev/otp-inbox")
        assert res.status_code == 404
    finally:
        # get_settings is process-wide lru_cache'd — leaving it cleared
        # with the monkeypatched env (which pytest is about to revert)
        # would serve every subsequent test a "production" Settings object.
        get_settings.cache_clear()


def test_otp_inbox_200s_in_development():
    """Sanity check for the test above: confirms the 404 is really the
    APP_ENV gate, not the route being broken or missing."""
    res = client.get("/dev/otp-inbox")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_app_refuses_to_start_with_inbox_channel_outside_development():
    from app.core.config import Settings

    with pytest.raises(Exception):
        Settings(
            APP_ENV="production",
            SECRET_KEY="test-secret",
            MPESA_CALLBACK_URL="https://example.com/callback",
            CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode(),
            OTP_DELIVERY_CHANNEL="inbox",
        )


# ── Work Order 05 A1: /auth/login closed outside development ────────────────

def test_login_404s_when_not_development(monkeypatch):
    from app.core.config import get_settings
    import app.api.routes.auth as auth_route

    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    monkeypatch.setattr(auth_route, "settings", get_settings())
    try:
        res = client.post("/api/v1/auth/login", json={"phone_number": "0788000007"})
        assert res.status_code == 404
    finally:
        get_settings.cache_clear()
        monkeypatch.setattr(auth_route, "settings", get_settings())


def test_app_starts_fine_with_inbox_channel_in_development():
    from app.core.config import Settings

    # Must NOT raise.
    Settings(
        APP_ENV="development",
        SECRET_KEY="test-secret",
        MPESA_CALLBACK_URL="https://example.com/callback",
        CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        OTP_DELIVERY_CHANNEL="inbox",
    )
