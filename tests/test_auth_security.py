"""
Work Order 04 — auth hardening tests (Block A).

Reuses test_api.py's TestClient/DB setup, same reasoning as test_resale.py:
two separate engines both bound to app.dependency_overrides would fight
over which one a given test actually hits.
"""
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
