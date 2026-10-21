"""
The signed-in user's own account: /me/profile, /me/activity, and
/me/sign-out-everywhere. Reuses test_api.py's TestClient/DB setup.
"""
import uuid

import pytest

from tests.test_api import client

API = "/api/v1"


def _otp_login(phone: str, agent: str = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp}, headers={"User-Agent": agent})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": "m", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)


def test_profile_covers_every_role():
    owner = _otp_login("0755400001")
    org = client.post(f"{API}/organisations/", json={"business_name": "Profile Test Org"}, headers=owner).json()
    event = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Profile Gig", "venue": "V", "event_date": "2027-03-01T18:00",
        "ticket_price_kes": 500, "total_capacity": 10,
    }, headers=owner).json()
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0755400001", "quantity": 2}, headers=owner).json()
    client.post(f"{API}/payments/{pay['payment_id']}/dev-confirm", headers=owner)

    p = client.get(f"{API}/me/profile", headers=owner).json()
    assert p["user"]["phone_number"] == "254755400001"
    assert p["attendee"] == {"tickets_held": 2, "upcoming_events": 1, "events_attended": 0}
    assert p["seller"]["active_listings"] == 0
    assert p["organisations"][0] == {**p["organisations"][0], "business_name": "Profile Test Org", "role": "owner", "events": 1}
    assert p["platform_admin"] is False
    assert p["security"]["sign_in_methods"] == ["Phone"]
    assert p["security"]["last_sign_in"]["method"] == "phone code"
    assert p["security"]["last_sign_in"]["device"] == "Chrome on Windows"


def test_display_name_can_be_edited():
    me = _otp_login("0755400002")
    res = client.patch(f"{API}/me/profile", json={"display_name": "  Wanjiku   Mwangi "}, headers=me)
    assert res.status_code == 200 and res.json()["user"]["display_name"] == "Wanjiku Mwangi"
    assert client.patch(f"{API}/me/profile", json={"display_name": "   "}, headers=me).status_code == 422


def test_activity_log_tells_the_story():
    me = _otp_login("0755400003")
    org = client.post(f"{API}/organisations/", json={"business_name": "Activity Org"}, headers=me).json()
    event = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Activity Gig", "venue": "V", "event_date": "2027-03-01T18:00",
        "ticket_price_kes": 700, "total_capacity": 10,
    }, headers=me).json()
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0755400003"}, headers=me).json()
    client.post(f"{API}/payments/{pay['payment_id']}/dev-confirm", headers=me)

    items = client.get(f"{API}/me/activity", headers=me).json()["items"]
    kinds = [i["kind"] for i in items]
    assert kinds[-1] == "account_created"  # oldest last
    assert {"sign_in", "joined_org", "purchase"} <= set(kinds)
    purchase = next(i for i in items if i["kind"] == "purchase")
    assert purchase["title"] == "Bought 1 ticket for Activity Gig"
    assert purchase["amount_kes"] == -700 and purchase["category"] == "purchase"
    assert [i["at"] for i in items] == sorted((i["at"] for i in items), reverse=True)

    security = client.get(f"{API}/me/activity", params={"category": "security"}, headers=me).json()["items"]
    assert {i["category"] for i in security} == {"security"}

    first = client.get(f"{API}/me/activity", params={"limit": 2}, headers=me).json()
    assert len(first["items"]) == 2 and first["has_more"] is True
    rest = client.get(f"{API}/me/activity", params={"before": first["items"][-1]["at"]}, headers=me).json()["items"]
    assert all(i["at"] < first["items"][-1]["at"] for i in rest)


def test_activity_is_private():
    a = _otp_login("0755400004")
    b = _otp_login("0755400005")
    client.patch(f"{API}/me/profile", json={"display_name": "Only Mine"}, headers=a)
    b_items = client.get(f"{API}/me/activity", headers=b).json()["items"]
    assert all("0755400004" not in (i["detail"] or "") for i in b_items)
    assert client.get(f"{API}/me/profile", headers=b).json()["user"]["phone_number"] == "254755400005"


def test_sign_out_everywhere_ends_other_sessions_but_not_this_one():
    laptop = _otp_login("0755400006", agent="Mozilla/5.0 (Macintosh; Mac OS X) Safari/605")
    phone = _otp_login("0755400006", agent="Mozilla/5.0 (Linux; Android 14) Chrome/130.0")
    assert client.get(f"{API}/auth/me", headers=laptop).status_code == 200

    res = client.post(f"{API}/me/sign-out-everywhere", headers=phone)
    assert res.status_code == 200
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}

    assert client.get(f"{API}/auth/me", headers=laptop).status_code == 401
    assert client.get(f"{API}/auth/me", headers=phone).status_code == 401
    assert client.get(f"{API}/auth/me", headers=fresh).status_code == 200

    items = client.get(f"{API}/me/activity", params={"category": "security"}, headers=fresh).json()["items"]
    assert items[0]["kind"] == "sign_out_everywhere"
    devices = {i["detail"] for i in items if i["kind"] == "sign_in"}
    assert "with phone code · Safari on macOS" in devices and "with phone code · Chrome on Android" in devices
