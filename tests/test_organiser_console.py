"""
Organiser Console API tests — the organisation-scoped endpoints in
app/api/routes/organiser_console.py, plus the event create/edit rules in
app/services/organiser_service.py that its Event Management form drives.

Reuses test_api.py's TestClient/DB setup, same as the other modules.
Logins are module-scoped (a handful of users shared across tests) because
/auth/login is rate-limited per IP across the whole run.
"""
import csv
import io
import uuid

import pytest

from tests.test_api import client

API = "/api/v1"


def _login(phone: str) -> dict:
    res = client.post(f"{API}/auth/login", json={"phone_number": phone})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(scope="module")
def owner():
    return _login("0711500001")


@pytest.fixture(scope="module")
def staff():
    return _login("0711500002")


@pytest.fixture(scope="module")
def outsider():
    return _login("0711500003")


@pytest.fixture(scope="module")
def buyer():
    return _login("0711500004")


@pytest.fixture(scope="module")
def org(owner):
    res = client.post(f"{API}/organisations/", json={"business_name": "Console Test Events"}, headers=owner)
    assert res.status_code == 201, res.text
    org = res.json()
    res = client.post(
        f"{API}/organisations/{org['id']}/members",
        json={"phone_number": "0711500002", "role": "staff", "name": "Sam Staff"},
        headers=owner,
    )
    assert res.status_code == 201, res.text
    return org


def _event_form(org_id: str, **overrides) -> dict:
    form = {
        "organization_id": org_id,
        "title": "Console Launch Night",
        "category": "Music",
        "venue": "KICC, Nairobi",
        "artists": ["Sauti Sol"],
        "event_date": "2027-06-01T19:00",
        "ends_at": "2027-06-01T23:00",
        "description": "<p>Live</p>",
        "description_html": "<p>Live</p>",
        "status": "live",
        "max_resale_multiplier": 1.5,
        "resale_royalty_percent": 12,
        "resale_enabled": True,
        "resale_window_open_days": 0,
        "resale_window_close_hours": 2,
        "tiers": [
            {"key": "a", "name": "General", "description": "", "price": 1000, "capacity": 50,
             "salesStart": "", "salesEnd": "", "perOrderMax": 4, "visibility": "public"},
            {"key": "b", "name": "Guest List", "description": "", "price": 0, "capacity": 10,
             "salesStart": "", "salesEnd": "", "perOrderMax": 1, "visibility": "hidden"},
        ],
        "gates": [{"name": "Gate A"}, {"name": "Gate B"}],
    }
    form.update(overrides)
    return form


@pytest.fixture(scope="module")
def event(owner, org):
    res = client.post(f"{API}/events/", json=_event_form(org["id"]), headers=owner)
    assert res.status_code == 201, res.text
    res = client.get(f"{API}/organisations/{org['id']}/events/{res.json()['id']}", headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def _buy(event_id: str, headers: dict, monkeypatch, phone: str = "0711500004", quantity: int = 1, tier_id=None) -> dict:
    """Purchase + dev-confirm, with the STK push and the mint stubbed."""
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": f"m-{uuid.uuid4().hex[:8]}", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:8]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)
    body = {"event_id": event_id, "phone_number": phone, "quantity": quantity}
    if tier_id:
        body["tier_id"] = tier_id
    res = client.post(f"{API}/payments/purchase", json=body, headers=headers)
    assert res.status_code == 201, res.text
    data = res.json()
    res = client.post(f"{API}/payments/{data['payment_id']}/dev-confirm", headers=headers)
    assert res.status_code == 200, res.text
    return data


# ── Event create / edit ─────────────────────────────────────────────────────

def test_create_event_stores_the_full_form(event):
    assert event["status"] == "live"
    assert event["category"] == "Music"
    assert event["artists"] == ["Sauti Sol"]
    assert event["ends_at"].startswith("2027-06-01T23:00")
    assert [g["name"] for g in event["gates"]] == ["Gate A", "Gate B"]
    assert all(g["id"] for g in event["gates"])
    assert [t["name"] for t in event["tiers"]] == ["General", "Guest List"]
    assert event["tiers"][1]["visibility"] == "hidden"
    assert event["total_capacity"] == 60  # auto-summed from tiers
    assert event["resale_ceiling_multiplier"] == 1.5
    assert event["resale_royalty_percent"] == 12
    assert event["tiers"][0]["resale_ceiling_kes"] == 1500


def test_public_listing_hides_hidden_tiers(event):
    res = client.get(f"{API}/events/{event['id']}")
    assert res.status_code == 200
    assert [t["name"] for t in res.json()["tiers"]] == ["General"]
    assert res.json()["ticket_price_kes"] == 1000


def test_draft_is_not_public_but_organiser_can_see_it(owner, org):
    res = client.post(f"{API}/events/", json=_event_form(org["id"], title="Secret Draft", status="draft", venue=""), headers=owner)
    assert res.status_code == 201, res.text
    draft_id = res.json()["id"]
    assert client.get(f"{API}/events/{draft_id}").status_code == 404
    assert draft_id not in [e["id"] for e in client.get(f"{API}/events/").json()]
    mine = client.get(f"{API}/organisations/{org['id']}/events", headers=owner).json()
    assert {"id": draft_id, "status": "draft"}.items() <= next(e for e in mine if e["id"] == draft_id).items()


def test_publishing_a_free_public_tier_is_rejected(owner, org):
    form = _event_form(org["id"], title="Free For All")
    form["tiers"][0]["price"] = 0
    res = client.post(f"{API}/events/", json=form, headers=owner)
    assert res.status_code == 400
    assert "M-Pesa can't charge KES 0" in res.json()["detail"]


def test_flat_single_tier_payload_still_works(owner, org):
    res = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Flat Payload", "venue": "Venue",
        "event_date": "2027-07-01T18:00:00", "organizer_phone": "0700000000",
        "ticket_price_kes": 300, "total_capacity": 20,
    }, headers=owner)
    assert res.status_code == 201, res.text
    assert res.json()["tiers"][0]["name"] == "General"
    assert res.json()["total_capacity"] == 20


def test_edit_event_updates_tiers_and_gates(owner, org, event):
    tiers = [dict(t) for t in event["tiers"]]
    tiers[0]["name"] = "Early Bird"
    tiers.append({"name": "VIP", "price": 5000, "capacity": 5, "visibility": "public"})
    res = client.patch(f"{API}/events/{event['id']}", json={
        "title": "Console Launch Night (Updated)", "tiers": tiers,
        "gates": event["gates"] + [{"name": "VIP Entrance"}],
    }, headers=owner)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["title"] == "Console Launch Night (Updated)"
    assert [t["name"] for t in data["tiers"]] == ["Early Bird", "Guest List", "VIP"]
    assert data["tiers"][0]["id"] == event["tiers"][0]["id"]  # edited in place, not recreated
    assert [g["name"] for g in data["gates"]] == ["Gate A", "Gate B", "VIP Entrance"]
    assert data["gates"][0]["id"] == event["gates"][0]["id"]


def test_staff_and_outsiders_cannot_edit_events(staff, outsider, event):
    for headers in (staff, outsider):
        res = client.patch(f"{API}/events/{event['id']}", json={"title": "Hijacked"}, headers=headers)
        assert res.status_code == 403


# ── Purchase rules from the tier settings ───────────────────────────────────

def test_hidden_tier_cannot_be_bought(buyer, event, monkeypatch):
    from app.services import mpesa as mpesa_svc

    async def fake_stk_push(**kwargs):
        raise AssertionError("must not reach M-Pesa")

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    hidden = next(t for t in event["tiers"] if t["visibility"] == "hidden")
    res = client.post(f"{API}/payments/purchase", json={
        "event_id": event["id"], "phone_number": "0711500004", "tier_id": hidden["id"],
    }, headers=buyer)
    assert res.status_code == 400
    assert "isn't on public sale" in res.json()["detail"]


def test_per_order_max_is_enforced(buyer, event):
    general = event["tiers"][0]
    res = client.post(f"{API}/payments/purchase", json={
        "event_id": event["id"], "phone_number": "0711500004", "tier_id": general["id"], "quantity": 5,
    }, headers=buyer)
    assert res.status_code == 400
    assert "at most 4" in res.json()["detail"]


def test_tier_with_sales_cannot_be_removed_or_shrunk(owner, buyer, event, monkeypatch):
    general = event["tiers"][0]
    _buy(event["id"], buyer, monkeypatch, tier_id=general["id"], quantity=2)

    # Dropping the tier that has sales (keeping only Guest List) is refused.
    guest_list = event["tiers"][1]
    res = client.patch(f"{API}/events/{event['id']}", json={"tiers": [
        {"id": guest_list["id"], "name": "Guest List", "price": 0, "capacity": 10, "visibility": "hidden"},
    ]}, headers=owner)
    assert res.status_code == 400
    assert "already has tickets" in res.json()["detail"]

    shrunk = [{"id": general["id"], "name": "Early Bird", "price": 1000, "capacity": 1, "visibility": "public"}]
    res = client.patch(f"{API}/events/{event['id']}", json={"tiers": shrunk}, headers=owner)
    assert res.status_code == 400
    assert "already sold 2" in res.json()["detail"]


# ── Money, tickets, audit ───────────────────────────────────────────────────

def test_control_center_and_earnings_reflect_real_sales(owner, staff, org, event):
    res = client.get(f"{API}/organisations/{org['id']}/control-center", headers=staff)
    assert res.status_code == 200, res.text
    cc = res.json()
    assert cc["organiserName"] == "Console Test Events"
    assert cc["allTimeTickets"] == 2
    assert cc["allTimeRevenueKes"] == 2000
    assert cc["activePlans"] == []
    # Event is in 2027 — earnings haven't released yet.
    assert cc["wallet"] == {"available": 0, "pending": 2000 - 100 - 20}

    earnings = client.get(f"{API}/organisations/{org['id']}/earnings", headers=owner).json()
    assert earnings["totals"]["totalRevenue"] == 2000
    assert earnings["totals"]["chaintixFee"] == 100  # 5%
    assert earnings["totals"]["scanningFees"] == 20  # KES 10 x 2
    assert earnings["totals"]["yourEarnings"] == 1880
    assert earnings["wallet"]["totalPaidOut"] == 0
    row = earnings["perEventBreakdown"][0]
    assert row["event_id"] == event["id"] and row["payout_status"] == "Pending"
    assert {"name": "Early Bird", "sold": 2, "revenue": 2000} in row["tiers"]


def test_ticket_central_and_audit_lookup(owner, org, event):
    rows = client.get(f"{API}/organisations/{org['id']}/tickets", params={"event_id": event["id"]}, headers=owner).json()
    assert len(rows) == 2
    assert all(r["status"] == "active" and r["holder_phone_masked"].endswith("004") for r in rows)
    assert all(r["timeline"][0]["label"] == "Order placed" for r in rows)
    assert all(r["chain_status"] == "pending" for r in rows)  # mint stubbed out

    by_phone = client.get(f"{API}/organisations/{org['id']}/audit-lookup", params={"q": "0711500004"}, headers=owner).json()
    assert {r["ticket_id"] for r in by_phone} >= {r["ticket_id"] for r in rows}

    receipt = rows[0]["ticket_id"]  # payment receipt is DEV<payment id>; look up via ticket id prefix instead
    by_id = client.get(f"{API}/organisations/{org['id']}/audit-lookup", params={"q": receipt[:8]}, headers=owner).json()
    assert receipt in [r["ticket_id"] for r in by_id]


def test_other_organisations_cannot_read_anything(outsider, org, event):
    for path in ("control-center", "earnings", "tickets", "scanners", "guest-lists", "attendance",
                 "revenue-breakdown", "royalty-ledger", "resale-compliance", "profile", "payout-details",
                 "exports", "reports", f"events/{event['id']}/crowd-control", f"events/{event['id']}/contract-status"):
        res = client.get(f"{API}/organisations/{org['id']}/{path}", headers=outsider)
        assert res.status_code == 403, f"{path} -> {res.status_code}"


# ── Complimentary tickets ───────────────────────────────────────────────────

def test_owner_sends_complimentary_ticket_from_hidden_tier(owner, staff, org, event, monkeypatch):
    from app.worker import mint_ticket_nft
    queued = []
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda ticket_id: queued.append(ticket_id))

    hidden = next(t for t in event["tiers"] if t["visibility"] == "hidden")
    body = {"event_id": event["id"], "tier_id": hidden["id"], "recipient_name": "Wanjiku",
            "recipient_phone": "0711500099", "note": "Press"}
    assert client.post(f"{API}/organisations/{org['id']}/complimentary-tickets", json=body, headers=staff).status_code == 403

    res = client.post(f"{API}/organisations/{org['id']}/complimentary-tickets", json=body, headers=owner)
    assert res.status_code == 201, res.text
    ticket_id = res.json()["ticket_id"]
    assert queued == [ticket_id]  # minted like any other ticket

    guests = client.get(f"{API}/organisations/{org['id']}/guest-lists", headers=staff).json()
    assert guests[0]["ticket_id"] == ticket_id
    assert guests[0]["recipient_name"] == "Wanjiku" and guests[0]["note"] == "Press"
    assert guests[0]["status"] == "active"

    cc = client.get(f"{API}/organisations/{org['id']}/control-center", headers=owner).json()
    assert cc["allTimeTickets"] == 2  # comps aren't sales
    assert cc["allTimeRevenueKes"] == 2000


# ── Gate: crowd control, manual override, scanners ──────────────────────────

def test_manual_override_admits_once_and_shows_in_crowd_control(staff, org, event):
    rows = client.get(f"{API}/organisations/{org['id']}/tickets", params={"event_id": event["id"], "status_filter": "active"}, headers=staff).json()
    ticket_id = rows[0]["ticket_id"]

    url = f"{API}/organisations/{org['id']}/events/{event['id']}/manual-override"
    assert client.post(url, json={"ticket_id": ticket_id, "reason": "  "}, headers=staff).status_code == 422
    res = client.post(url, json={"ticket_id": ticket_id, "reason": "Phone died at the gate"}, headers=staff)
    assert res.status_code == 200, res.text
    again = client.post(url, json={"ticket_id": ticket_id, "reason": "again"}, headers=staff)
    assert again.status_code == 400 and "already been admitted" in again.json()["detail"]

    cc = client.get(f"{API}/organisations/{org['id']}/events/{event['id']}/crowd-control", headers=staff).json()
    assert cc["admitted"] == 1
    assert {"gate": "Manual / online", "admitted": 1, "denied": 0} in cc["throughputByGate"]
    assert cc["queueEstimate"] == 2  # 2 bought + 1 comp held, 1 admitted
    assert [g["gate_name"] for g in cc["gates"]][:2] == ["Gate A", "Gate B"]


def test_scanner_hub_shows_invite_code_then_revoked(owner, org, event):
    res = client.post(f"{API}/gate/scanners", json={"event_id": event["id"], "gate_name": "Gate A", "label": "Gate A — Scanner 1"}, headers=owner)
    assert res.status_code == 201, res.text
    reg = res.json()

    devices = client.get(f"{API}/organisations/{org['id']}/scanners", headers=owner).json()
    device = next(d for d in devices if d["id"] == reg["scanner_id"])
    assert device["status"] == "invited"
    assert device["device_name"] == "Gate A — Scanner 1"
    assert device["enrollment_code"] == reg["enrollment_code"]

    assert client.post(f"{API}/gate/scanners/{reg['scanner_id']}/revoke", headers=owner).status_code == 204
    devices = client.get(f"{API}/organisations/{org['id']}/scanners", headers=owner).json()
    device = next(d for d in devices if d["id"] == reg["scanner_id"])
    assert device["status"] == "revoked" and device["enrollment_code"] is None

    # The code handed out before the revoke must not work afterwards.
    res = client.post(f"{API}/gate/enroll", json={"enrollment_code": reg["enrollment_code"], "device_id": "revoked-dev-1"})
    assert res.status_code == 404


def test_registering_a_device_at_a_new_gate_adds_the_gate(owner, org, event):
    res = client.post(f"{API}/gate/scanners", json={"event_id": event["id"], "gate_name": "Back Door"}, headers=owner)
    assert res.status_code == 201
    gates = client.get(f"{API}/organisations/{org['id']}/events/{event['id']}", headers=owner).json()["gates"]
    assert "Back Door" in [g["name"] for g in gates]


def test_contract_status_reports_unminted_tickets(owner, org, event):
    res = client.get(f"{API}/organisations/{org['id']}/events/{event['id']}/contract-status", headers=owner)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["total_minted"] == 0
    assert data["pending_mints"] + len(data["failed_mint_queue"]) == 3
    assert data["avg_gas_cost_usd"] is None


# ── Exports & settings ──────────────────────────────────────────────────────

def test_csv_export_round_trip(owner, org, event):
    base = f"{API}/organisations/{org['id']}/exports"
    assert client.post(base, json={"type": "ticket_sales", "format": "pdf"}, headers=owner).status_code == 400
    assert client.post(base, json={"type": "nonsense", "format": "csv"}, headers=owner).status_code == 400

    res = client.post(base, json={"type": "ticket_sales", "format": "csv"}, headers=owner)
    assert res.status_code == 201, res.text
    export = res.json()
    assert export["status"] == "ready"
    assert client.get(base, headers=owner).json()[0]["id"] == export["id"]

    res = client.get(f"{base}/{export['id']}/download", headers=owner)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[0][:3] == ["ticket_id", "event", "tier"]
    assert len(rows) - 1 == 3  # 2 sold + 1 complimentary
    assert sorted(r[4] for r in rows[1:]) == ["no", "no", "yes"]


def test_sales_statement_report_downloads(owner, org, event):
    reports = client.get(f"{API}/organisations/{org['id']}/reports", headers=owner).json()
    assert [r["id"] for r in reports] == [event["id"]]
    res = client.get(f"{API}/organisations/{org['id']}/reports/{event['id']}/download", headers=owner)
    assert res.status_code == 200 and res.text.startswith("ticket_id,")


def test_profile_and_payout_settings(owner, staff, org):
    base = f"{API}/organisations/{org['id']}"
    assert client.patch(f"{base}/profile", json={"kraPin": "P000"}, headers=staff).status_code == 403
    res = client.patch(f"{base}/profile", json={"businessName": "Console Events Ltd", "kraPin": "P051234567X",
                                                 "contactEmail": "hi@example.com", "contactPhone": "0711500001"}, headers=owner)
    assert res.status_code == 200, res.text
    assert client.get(f"{base}/profile", headers=staff).json()["contactPhone"] == "254711500001"

    assert client.get(f"{base}/payout-details", headers=owner).json() == {"payoutMethod": "mpesa", "payoutDestination": ""}
    assert client.patch(f"{base}/payout-details", json={"payoutMethod": "bank", "payoutDestination": "0123456789"}, headers=staff).status_code == 403
    assert client.patch(f"{base}/payout-details", json={"payoutMethod": "bank", "payoutDestination": "0123456789"}, headers=owner).status_code == 200
    assert client.get(f"{base}/payout-details", headers=owner).json()["payoutMethod"] == "bank"


def test_team_member_names_are_returned(owner, org):
    members = client.get(f"{API}/organisations/{org['id']}/members", headers=owner).json()
    assert {"Sam Staff"} <= {m["display_name"] for m in members}


# ── Organiser resale settings reach the seller ──────────────────────────────

def test_resale_disabled_marks_tickets_ineligible(owner, org, buyer, monkeypatch):
    res = client.post(f"{API}/events/", json=_event_form(org["id"], title="No Resale Gig", resale_enabled=False), headers=owner)
    assert res.status_code == 201, res.text
    data = _buy(res.json()["id"], buyer, monkeypatch)

    eligible = client.get(f"{API}/resale/eligible-tickets", headers=buyer).json()
    row = next(t for t in eligible if t["ticket_id"] == data["ticket_id"])
    assert row["eligible"] is False
    assert row["ineligible_reason"] == "The organiser has turned off resale for this event"


# ── Event cover images ──────────────────────────────────────────────────────

def _png_data_url(width: int, height: int, color=(200, 30, 90)) -> str:
    import base64
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_event_image_is_processed_and_served(owner, org):
    from PIL import Image
    res = client.post(f"{API}/events/", json=_event_form(org["id"], title="Poster Night", image_data_url=_png_data_url(2400, 1200)), headers=owner)
    assert res.status_code == 201, res.text
    public = res.json()
    assert public["image_url"].startswith(f"/api/v1/events/{public['id']}/image?v=")
    assert public["category"] == "Music"
    assert "base64" not in res.text  # payloads carry a URL, never the bytes

    listed = next(e for e in client.get(f"{API}/events/").json() if e["id"] == public["id"])
    assert listed["image_url"] == public["image_url"]

    img = client.get(public["image_url"])
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/webp"
    assert "immutable" in img.headers["cache-control"]
    assert Image.open(io.BytesIO(img.content)).size == (1600, 800)  # downscaled, aspect kept

    cached = client.get(public["image_url"], headers={"If-None-Match": img.headers["etag"]})
    assert cached.status_code == 304


def test_event_image_unchanged_replaced_and_removed(owner, org):
    res = client.post(f"{API}/events/", json=_event_form(org["id"], title="Swap Poster", image_data_url=_png_data_url(300, 300)), headers=owner)
    event_id, first_url = res.json()["id"], res.json()["image_url"]

    # The form echoing the current URL back (or not sending it) keeps the image.
    res = client.patch(f"{API}/events/{event_id}", json={"title": "Swap Poster 2", "image_data_url": first_url}, headers=owner)
    assert res.json()["image_url"] == first_url
    res = client.patch(f"{API}/events/{event_id}", json={"title": "Swap Poster 3"}, headers=owner)
    assert res.json()["image_url"] == first_url

    import time
    time.sleep(1.1)  # the URL version is per-second
    res = client.patch(f"{API}/events/{event_id}", json={"image_data_url": _png_data_url(300, 300, (0, 0, 0))}, headers=owner)
    assert res.json()["image_url"] != first_url

    res = client.patch(f"{API}/events/{event_id}", json={"image_data_url": None}, headers=owner)
    assert res.json()["image_url"] is None
    assert client.get(f"{API}/events/{event_id}/image").status_code == 404


def test_bad_event_images_are_rejected(owner, org):
    import base64
    cases = [
        ("data:text/plain;base64," + base64.b64encode(b"hello").decode(), "PNG, JPEG or WebP"),
        ("data:image/png;base64," + base64.b64encode(b"not really a png").decode(), "isn't a valid image"),
        ("https://example.com/poster.png", None),  # not an upload: ignored, event has no image
    ]
    for data_url, message in cases:
        res = client.post(f"{API}/events/", json=_event_form(org["id"], title="Bad Poster", image_data_url=data_url), headers=owner)
        if message:
            assert res.status_code == 400, res.text
            assert message in res.json()["detail"]
        else:
            assert res.status_code == 201 and res.json()["image_url"] is None
