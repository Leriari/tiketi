"""
Platform Admin console (app/api/routes/admin.py): access by role, and that
each admin control really changes how the platform behaves — suspension,
event approvals, fees, feature flags, invites, broadcasts.
"""
import uuid

import pytest

from app.models.models import User
from tests.test_api import TestingSessionLocal, client

API = "/api/v1"


def _login(phone: str) -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _make_admin(phone: str, role: str | None = None) -> dict:
    headers = _login(phone)
    db = TestingSessionLocal()
    user = db.query(User).filter(User.phone_number == "254" + phone[1:]).one()
    user.is_platform_admin, user.platform_admin_role = True, role
    db.commit()
    db.close()
    return headers


def _org_with_event(owner: dict, name: str, price: int = 1000) -> tuple[dict, dict]:
    org = client.post(f"{API}/organisations/", json={"business_name": name}, headers=owner).json()
    event = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": f"{name} Night", "venue": "KICC", "event_date": "2027-05-01T18:00",
        "ticket_price_kes": price, "total_capacity": 50,
    }, headers=owner)
    assert event.status_code == 201, event.text
    return org, event.json()


def _buy(buyer: dict, phone: str, event_id: str):
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event_id, "phone_number": phone, "quantity": 1}, headers=buyer)
    assert pay.status_code in (200, 201), pay.text
    assert client.post(f"{API}/payments/{pay.json()['payment_id']}/dev-confirm", headers=buyer).status_code == 200


def _public_ids() -> set[str]:
    return {e["id"] for e in client.get(f"{API}/events/?limit=200").json()}


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": "m", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)


@pytest.fixture(scope="module")
def admin():
    return _make_admin("0766500001")


def test_admin_pages_need_an_admin(admin):
    someone = _login("0766500002")
    assert client.get(f"{API}/admin/dashboard", headers=someone).status_code == 403
    dash = client.get(f"{API}/admin/dashboard", headers=admin)
    assert dash.status_code == 200
    assert {"gmv", "platformFeeRevenue", "activeEvents", "ticketsSoldToday", "organiserCount",
            "failedMintCount", "payoutQueueDepth"} <= set(dash.json())


def test_suspension_hides_events_and_freezes_the_organisation(admin):
    owner = _login("0766500003")
    org, event = _org_with_event(owner, "Suspend Me Ltd")
    assert event["id"] in _public_ids()

    assert client.post(f"{API}/admin/organisers/{org['id']}/suspend", json={"reason": ""}, headers=admin).status_code == 422
    assert client.post(f"{API}/admin/organisers/{org['id']}/suspend", json={"reason": "Chargebacks"}, headers=admin).status_code == 200

    assert event["id"] not in _public_ids()
    assert client.get(f"{API}/events/{event['id']}").status_code == 404
    blocked = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Another", "venue": "V", "event_date": "2027-06-01T18:00",
        "ticket_price_kes": 100, "total_capacity": 5,
    }, headers=owner)
    assert blocked.status_code == 403 and "suspended" in blocked.json()["detail"]
    row = next(o for o in client.get(f"{API}/admin/organisers", headers=admin).json() if o["id"] == org["id"])
    assert row["status"] == "suspended" and row["suspended_reason"] == "Chargebacks"

    assert client.post(f"{API}/admin/organisers/{org['id']}/reinstate", headers=admin).status_code == 200
    assert event["id"] in _public_ids()


def test_event_approval_holds_unverified_organisers(admin):
    assert client.post(f"{API}/admin/feature-flags/event_approval/toggle", headers=admin).json()["enabled"] is True
    try:
        owner = _login("0766500004")
        org, event = _org_with_event(owner, "Brand New Promoters")
        assert event["status"] == "draft" and event["review_state"] == "pending"
        assert event["id"] not in _public_ids()

        queue = client.get(f"{API}/admin/event-approvals", headers=admin).json()
        item = next(q for q in queue if q["id"] == event["id"])
        assert item["organiser"] == "Brand New Promoters" and item["checks"]

        assert client.post(f"{API}/admin/events/{event['id']}/reject", json={"reason": "Add a cover image"}, headers=admin).status_code == 200
        mine = client.get(f"{API}/organisations/{org['id']}/events/{event['id']}", headers=owner).json()
        assert mine["review_state"] == "rejected" and mine["review_note"] == "Add a cover image"

        # Resubmitting puts it back in the queue; approving publishes it.
        client.patch(f"{API}/events/{event['id']}", json={"status": "live"}, headers=owner)
        assert client.post(f"{API}/admin/events/{event['id']}/approve", headers=admin).status_code == 200
        assert event["id"] in _public_ids()

        # A verified organisation skips the queue.
        client.post(f"{API}/admin/organisers/{org['id']}/review", json={"decision": "verified"}, headers=admin)
        second = client.post(f"{API}/events/", json={
            "organization_id": org["id"], "title": "Second Night", "venue": "KICC", "event_date": "2027-05-02T18:00",
            "ticket_price_kes": 500, "total_capacity": 10,
        }, headers=owner).json()
        assert second["status"] == "published" and second["review_state"] is None
    finally:
        client.post(f"{API}/admin/feature-flags/event_approval/toggle", headers=admin)


def test_rejected_organisation_cannot_publish(admin):
    owner = _login("0766500005")
    org = client.post(f"{API}/organisations/", json={"business_name": "Rejected Co"}, headers=owner).json()
    assert client.post(f"{API}/admin/organisers/{org['id']}/review", json={"decision": "rejected"}, headers=admin).status_code == 400
    client.post(f"{API}/admin/organisers/{org['id']}/review", json={"decision": "rejected", "reason": "Fake KRA PIN"}, headers=admin)
    res = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Nope", "venue": "V", "event_date": "2027-06-01T18:00",
        "ticket_price_kes": 100, "total_capacity": 5,
    }, headers=owner)
    assert res.status_code == 400 and "couldn't verify" in res.json()["detail"]


def test_fee_changes_apply_going_forward(admin):
    owner = _login("0766500006")
    org, event = _org_with_event(owner, "Fee Test Events", price=1000)
    _buy(owner, "0766500006", event["id"])

    assert client.put(f"{API}/admin/fees", json={
        "platformFeePercent": 10, "scanningFeeKes": 20, "minPayoutKes": 200, "sellerEscrowDays": 3, "organiserEscrowDays": 5,
    }, headers=admin).status_code == 200
    try:
        _buy(owner, "0766500006", event["id"])
        totals = client.get(f"{API}/organisations/{org['id']}/earnings", headers=owner).json()
        # Old sale: 5% + KES 10. New sale: 10% + KES 20.
        assert totals["totals"]["chaintixFee"] == 50 + 100
        assert totals["totals"]["scanningFees"] == 10 + 20
        assert totals["wallet"]["minPayoutKes"] == 200

        fees = client.get(f"{API}/admin/fees", headers=admin).json()
        assert fees["current"]["platformFeePercent"] == 10
        assert fees["history"][0]["before"]["platformFeePercent"] == 5
        assert fees["history"][0]["after"]["platformFeePercent"] == 10
    finally:
        client.put(f"{API}/admin/fees", json={
            "platformFeePercent": 5, "scanningFeeKes": 10, "minPayoutKes": 101, "sellerEscrowDays": 2, "organiserEscrowDays": 4,
        }, headers=admin)


def test_roles_limit_what_an_admin_can_change(admin):
    support = _make_admin("0766500007", "support")
    finance = _make_admin("0766500008", "finance")
    fees = {"platformFeePercent": 5, "scanningFeeKes": 10, "minPayoutKes": 101, "sellerEscrowDays": 2, "organiserEscrowDays": 4}
    assert client.get(f"{API}/admin/fees", headers=support).status_code == 200  # everyone reads
    denied = client.put(f"{API}/admin/fees", json=fees, headers=support)
    assert denied.status_code == 403 and "Finance" in denied.json()["detail"]
    assert client.put(f"{API}/admin/fees", json=fees, headers=finance).status_code == 200
    assert client.post(f"{API}/admin/feature-flags/resale_marketplace/toggle", headers=finance).status_code == 403


def test_invites_apply_on_first_sign_in(admin):
    invited = client.post(f"{API}/admin/admins", json={"name": "Amina", "phone": "0766500009", "role": "compliance"}, headers=admin)
    assert invited.status_code == 201 and invited.json()["status"] == "invited"
    assert client.post(f"{API}/admin/admins", json={"name": "Amina", "phone": "0766500009", "role": "support"}, headers=admin).status_code == 409

    amina = _login("0766500009")
    admins = client.get(f"{API}/admin/admins", headers=amina).json()
    me = next(a for a in admins if a["name"] == "Amina")
    assert me["status"] == "active" and me["role"] == "compliance" and me["is_you"]

    assert client.delete(f"{API}/admin/admins/{me['id']}", headers=amina).status_code == 403  # not a super admin
    me_admin = next(a for a in client.get(f"{API}/admin/admins", headers=admin).json() if a["is_you"])
    assert client.delete(f"{API}/admin/admins/{me_admin['id']}", headers=admin).status_code == 400  # can't remove yourself
    assert client.delete(f"{API}/admin/admins/{me['id']}", headers=admin).status_code == 200
    assert client.get(f"{API}/admin/dashboard", headers=amina).status_code == 403


def test_broadcasts_reach_their_audience_in_app(admin):
    sms = client.post(f"{API}/admin/broadcasts", json={"message": "Hi", "channels": ["sms"], "audience": "all"}, headers=admin)
    assert sms.status_code == 400 and "SMS" in sms.json()["detail"]

    sent = client.post(f"{API}/admin/broadcasts", json={
        "message": "Gates open at 4pm for Savanna Sounds.", "channels": ["in_app"], "audience": "attendees",
    }, headers=admin)
    assert sent.status_code == 201 and sent.json()["status"] == "sent" and sent.json()["audience_size"] > 0

    attendee = _login("0766500010")
    seen = [a["message"] for a in client.get(f"{API}/announcements", headers=attendee).json()]
    assert "Gates open at 4pm for Savanna Sounds." in seen
    assert "Gates open at 4pm for Savanna Sounds." not in [a["message"] for a in client.get(f"{API}/announcements").json()]

    later = client.post(f"{API}/admin/broadcasts", json={
        "message": "Scheduled", "channels": ["in_app"], "audience": "all", "scheduledFor": "2099-01-01T10:00:00Z",
    }, headers=admin).json()
    assert later["status"] == "scheduled"
    assert "Scheduled" not in [a["message"] for a in client.get(f"{API}/announcements").json()]


def test_flags_change_behaviour(admin):
    buyer = _login("0766500011")
    _, event = _org_with_event(_login("0766500012"), "Flag Test Events")
    client.post(f"{API}/admin/feature-flags/simulated_payments/toggle", headers=admin)
    try:
        assert client.get("/").json()["simulated_payments"] is False
        pay = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0766500011", "quantity": 1}, headers=buyer).json()
        assert client.post(f"{API}/payments/{pay['payment_id']}/dev-confirm", headers=buyer).status_code == 403
    finally:
        client.post(f"{API}/admin/feature-flags/simulated_payments/toggle", headers=admin)
    assert client.get("/").json()["simulated_payments"] is True

    flags = {f["key"]: f for f in client.get(f"{API}/admin/feature-flags", headers=admin).json()}
    assert flags["simulated_payments"]["supports_rollout"] is False
    assert client.put(f"{API}/admin/feature-flags/simulated_payments/rollout", json={"rollout_percent": 50}, headers=admin).status_code == 400


def test_audit_log_records_admin_actions(admin):
    rows = client.get(f"{API}/admin/audit-log", params={"q": "organiser_suspended"}, headers=admin).json()
    assert rows and rows[0]["action"] == "organiser_suspended" and rows[0]["reason"] == "Chargebacks"
    assert rows[0]["at"].endswith("Z")
    assert all(r["action"] != "sign_in" for r in client.get(f"{API}/admin/audit-log", headers=admin).json())
    csv = client.get(f"{API}/admin/audit-log/export", headers=admin)
    assert csv.status_code == 200 and csv.text.startswith("at_utc,actor,action")


def test_read_pages_answer(admin):
    for path in ("organisers", "event-approvals", "costs", "payouts", "resale-compliance", "fraud-signals",
                 "broadcasts", "broadcast-channels", "admins", "notifications", "feature-flags"):
        assert client.get(f"{API}/admin/{path}", headers=admin).status_code == 200, path
