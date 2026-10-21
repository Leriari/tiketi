"""
How the API behaves when deployed without SMS (the hosted demo):
OTP_DELIVERY_CHANNEL=disabled + DEMO_PHONE_CODES, GOOGLE_PHONE_CONFIRMATION=
unverified, and the simulated-payments switch. Settings are patched on the
shared settings object, as in test_firebase_auth.py.
"""
import pytest

from tests.test_api import client
from app.api.routes import auth as auth_routes
from app.services import auth_service

API = "/api/v1"
ISS = "https://securetoken.google.com/test-project"


@pytest.fixture(autouse=True)
def hosted_demo(monkeypatch):
    s = auth_routes.settings
    monkeypatch.setattr(s, "APP_ENV", "production")
    monkeypatch.setattr(s, "OTP_DELIVERY_CHANNEL", "disabled")
    monkeypatch.setattr(s, "DEMO_PHONE_CODES", "0766500001:482913")
    monkeypatch.setattr(s, "GOOGLE_PHONE_CONFIRMATION", "unverified")
    monkeypatch.setattr(s, "FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setattr(s, "FIREBASE_API_KEY", "k")
    monkeypatch.setattr(s, "ALLOW_SIMULATED_PAYMENTS", False)

    def fake_verify(token):
        sub = token.removeprefix("google:")
        return {"iss": ISS, "sub": f"fb-{sub}", "email": f"{sub}@example.com", "email_verified": True,
                "firebase": {"sign_in_provider": "google.com", "identities": {"google.com": [sub]}}}

    monkeypatch.setattr(auth_service, "verify_firebase_token", fake_verify)


def test_health_tells_the_login_screen_what_works():
    h = client.get("/").json()
    assert h["phone_login"] == "demo_numbers"
    assert h["google_phone_confirmation"] == "unverified"
    assert h["simulated_payments"] is False


def test_demo_number_signs_in_with_its_fixed_code_and_no_code_leaks():
    res = client.post(f"{API}/auth/request-otp", json={"phone_number": "0766500001"})
    assert res.status_code == 200 and "dev_otp" not in res.json()
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": "0766500001", "otp_code": "482913"})
    assert res.status_code == 200


def test_other_numbers_are_told_to_use_google():
    res = client.post(f"{API}/auth/request-otp", json={"phone_number": "0766500099"})
    assert res.status_code == 400 and "Continue with Google" in res.json()["detail"]


def test_dev_shortcuts_are_closed():
    assert client.post(f"{API}/auth/login", json={"phone_number": "0766500001"}).status_code == 404


def test_first_google_sign_in_records_an_unverified_phone():
    first = client.post(f"{API}/auth/firebase", json={"id_token": "google:g-wanjiru"}).json()
    assert first["needs_phone"] is True
    res = client.post(f"{API}/auth/google-phone", json={"link_token": first["link_token"], "phone_number": "0766500010"})
    assert res.status_code == 200, res.text
    session = res.json()
    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}).json()
    assert me["phone_verified"] is False and me["google_linked"] is True
    # Next time Google alone signs straight in.
    again = client.post(f"{API}/auth/firebase", json={"id_token": "google:g-wanjiru"}).json()
    assert again["needs_phone"] is False and again["user_id"] == session["user_id"]


def test_unverified_claim_cannot_take_an_existing_account():
    client.post(f"{API}/auth/request-otp", json={"phone_number": "0766500001"})
    client.post(f"{API}/auth/verify-otp", json={"phone_number": "0766500001", "otp_code": "482913"})
    link = client.post(f"{API}/auth/firebase", json={"id_token": "google:g-squatter"}).json()["link_token"]
    res = client.post(f"{API}/auth/google-phone", json={"link_token": link, "phone_number": "0766500001"})
    assert res.status_code == 409


def test_google_phone_route_is_off_when_sms_confirmation_is_on(monkeypatch):
    monkeypatch.setattr(auth_routes.settings, "GOOGLE_PHONE_CONFIRMATION", "sms")
    link = auth_service.create_google_link_token("g-x", None)
    assert client.post(f"{API}/auth/google-phone", json={"link_token": link, "phone_number": "0766500020"}).status_code == 404


def test_simulated_payments_switch(monkeypatch):
    phone = "0766500001"
    client.post(f"{API}/auth/request-otp", json={"phone_number": phone})
    token = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": "482913"}).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.post(f"{API}/payments/does-not-exist/dev-confirm", headers=h).status_code == 404  # route closed
    monkeypatch.setattr(auth_routes.settings, "ALLOW_SIMULATED_PAYMENTS", True)
    res = client.post(f"{API}/payments/does-not-exist/dev-confirm", headers=h)
    assert res.status_code == 404 and res.json()["detail"] == "Payment not found"  # route open, payment missing
