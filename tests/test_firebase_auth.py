"""
Firebase sign-in — POST /auth/firebase, for phone (Firebase-sent SMS) and
Google, including linking a Google account to a phone.

Firebase's token check (auth_service.verify_firebase_token) is replaced with
a stub mapping fake token strings to the claims Firebase would put in a real
ID token. These tests cover what this backend does with a verified
identity; signature checking is google-auth's job and needs the network.
Reuses test_api.py's TestClient/DB setup.
"""
import pytest

from tests.test_api import client
from app.api.routes import auth as auth_routes
from app.services import auth_service

API = "/api/v1"
ISS = "https://securetoken.google.com/test-project"


def _phone_token(uid: str, phone: str) -> dict:
    return {"iss": ISS, "sub": uid, "phone_number": phone,
            "firebase": {"sign_in_provider": "phone", "identities": {"phone": [phone]}}}


def _google_token(uid: str, google_sub: str, email: str, verified: bool = True) -> dict:
    return {"iss": ISS, "sub": uid, "email": email, "email_verified": verified,
            "firebase": {"sign_in_provider": "google.com", "identities": {"google.com": [google_sub], "email": [email]}}}


TOKENS = {
    "phone-amina": _phone_token("fb-1", "+254733200001"),
    "google-amina": _google_token("fb-2", "g-amina", "amina@example.com"),
    "phone-brian": _phone_token("fb-3", "+254733200002"),
    "google-brian": _google_token("fb-4", "g-brian", "brian@example.com"),
    "google-chebet": _google_token("fb-5", "g-chebet", "chebet@example.com", verified=False),
    "phone-chebet": _phone_token("fb-6", "+254733200003"),
    "phone-uk": _phone_token("fb-7", "+447700900123"),
    "google-other": _google_token("fb-8", "g-other", "other@example.com"),
    "phone-dan": _phone_token("fb-9", "+254733200004"),
}


@pytest.fixture(autouse=True)
def firebase_enabled(monkeypatch):
    def fake_verify(token):
        if token not in TOKENS:
            raise ValueError("bad token")
        return TOKENS[token]

    monkeypatch.setattr(auth_routes.settings, "FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_API_KEY", "test-api-key")
    # Pin everything else too, so a developer's own .env can't leak in.
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_AUTH_DOMAIN", "")
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_APP_ID", "")
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_PHONE_AUTH", False)
    monkeypatch.setattr(auth_service, "verify_firebase_token", fake_verify)


def _firebase(id_token: str, link: str | None = None):
    body = {"id_token": id_token}
    if link:
        body["google_link_token"] = link
    return client.post(f"{API}/auth/firebase", json=body)


def _me(session: dict) -> dict:
    return client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}).json()


def test_disabled_without_firebase_config(monkeypatch):
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_PROJECT_ID", "")
    assert _firebase("phone-amina").status_code == 503


def test_forged_token_is_rejected():
    assert _firebase("not-a-real-token").status_code == 401


def test_phone_sign_in_creates_the_account():
    res = _firebase("phone-amina")
    assert res.status_code == 200, res.text
    session = res.json()
    assert session["needs_phone"] is False
    assert session["phone_number"] == "254733200001"
    assert _me(session)["google_linked"] is False


def test_only_kenyan_numbers():
    res = _firebase("phone-uk")
    assert res.status_code == 400 and "Kenyan" in res.json()["detail"]


def test_first_google_sign_in_links_after_phone_verification():
    first = _firebase("google-amina").json()
    assert first["needs_phone"] is True and first["access_token"] is None
    assert first["email"] == "amina@example.com"

    # Same phone as the existing phone-only account above -> joins it.
    existing = _firebase("phone-amina").json()
    linked = _firebase("phone-amina", first["link_token"]).json()
    assert linked["user_id"] == existing["user_id"]
    me = _me(linked)
    assert me["google_linked"] is True and me["email"] == "amina@example.com"

    # From now on Google alone signs straight in.
    again = _firebase("google-amina").json()
    assert again["needs_phone"] is False and again["user_id"] == existing["user_id"]


def test_google_then_new_phone_creates_one_account():
    link = _firebase("google-brian").json()["link_token"]
    session = _firebase("phone-brian", link).json()
    assert session["phone_number"] == "254733200002"
    assert _firebase("google-brian").json()["user_id"] == session["user_id"]


def test_unverified_google_email_is_not_saved():
    link = _firebase("google-chebet").json()
    assert link["email"] is None
    session = _firebase("phone-chebet", link["link_token"]).json()
    me = _me(session)
    assert me["google_linked"] is True and me["email"] is None


def test_one_google_account_per_phone_and_vice_versa():
    # g-amina is linked to 0733200001: linking it to a fresh phone is refused…
    stale = auth_service.create_google_link_token("g-amina", "amina@example.com")
    res = _firebase("phone-dan", stale)
    assert res.status_code == 409 and "different phone number" in res.json()["detail"]
    # …and 0733200001 can't take a second Google account.
    other = _firebase("google-other").json()["link_token"]
    res = _firebase("phone-amina", other)
    assert res.status_code == 409 and "different Google account" in res.json()["detail"]


def test_bad_link_token_is_rejected():
    res = _firebase("phone-amina", "garbage")
    assert res.status_code == 400 and "expired" in res.json()["detail"]


def test_link_token_is_not_a_session():
    link = auth_service.create_google_link_token("g-xyz", None)
    assert client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {link}"}).status_code == 401


def test_health_exposes_firebase_web_config():
    config = client.get("/").json()["firebase"]
    assert config["projectId"] == "test-project"
    assert config["apiKey"] == "test-api-key"
    assert config["authDomain"] == "test-project.firebaseapp.com"


# ── Google via Firebase + phone via the built-in OTP (FIREBASE_PHONE_AUTH off) ─

TOKENS["google-esther"] = _google_token("fb-10", "g-esther", "esther@example.com")


def _verify_with_builtin_otp(phone: str, link: str | None = None):
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    body = {"phone_number": phone, "otp_code": otp}
    if link:
        body["google_link_token"] = link
    return client.post(f"{API}/auth/verify-otp", json=body)


def test_google_links_through_builtin_otp_when_firebase_sms_is_off():
    link = _firebase("google-esther").json()["link_token"]
    res = _verify_with_builtin_otp("0733200005", link)
    assert res.status_code == 200, res.text
    session = res.json()
    assert _me(session)["google_linked"] is True
    assert _firebase("google-esther").json()["user_id"] == session["user_id"]


def test_expired_link_on_builtin_otp_keeps_the_code_usable():
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": "0733200006"}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": "0733200006", "otp_code": otp, "google_link_token": "garbage"})
    assert res.status_code == 400
    assert client.post(f"{API}/auth/verify-otp", json={"phone_number": "0733200006", "otp_code": otp}).status_code == 200


def test_health_reports_whether_firebase_sends_sms(monkeypatch):
    assert client.get("/").json()["firebase"]["phoneAuth"] is False
    monkeypatch.setattr(auth_routes.settings, "FIREBASE_PHONE_AUTH", True)
    assert client.get("/").json()["firebase"]["phoneAuth"] is True
