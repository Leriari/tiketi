"""
Gates (each ticket's gate, stored at purchase: app/services/gates.py) and
Work Order 05 B5 (scan reconciliation) tests.

Reuses test_api.py's TestClient/DB setup, same reasoning as the other
cross-file test modules in this suite.
"""
import pytest

from tests.test_api import client, TestingSessionLocal


@pytest.fixture(autouse=True)
def _fake_daraja(monkeypatch):
    """No real Daraja calls from tests: STK pushes and STK queries are faked."""
    import uuid
    from app.services import mpesa as mpesa_svc

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": f"m-{uuid.uuid4().hex[:8]}", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    async def fake_query(checkout_request_id):
        return {"ResponseCode": "0", "ResultCode": "0", "ResultDesc": "The service request is processed successfully."}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mpesa_svc, "query_stk_status", fake_query)


def _login(phone: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _create_org_and_event(headers: dict, capacity: int = 50) -> dict:
    org_res = client.post("/api/v1/organisations/", json={"business_name": "Partitioning Test Org"}, headers=headers)
    event_res = client.post("/api/v1/events/", json={
        "organization_id": org_res.json()["id"],
        "title": "Partitioning Test Event",
        "venue": "Test Venue",
        "event_date": "2027-05-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 150,
        "total_capacity": capacity,
    }, headers=headers)
    return event_res.json()


def _buy_ticket(headers: dict, event_id: str, phone: str) -> str:
    res = client.post("/api/v1/payments/purchase", json={
        "event_id": event_id, "phone_number": phone,
    }, headers=headers)
    assert res.status_code == 201, res.text
    payment_id = res.json()["payment_id"]
    ticket_id = res.json()["ticket_id"]
    res = client.post(f"/api/v1/payments/{payment_id}/dev-confirm", headers=headers)
    assert res.status_code == 200, res.text
    return ticket_id


def _register_and_enroll(headers: dict, event_id: str, device_id: str, gate_name: str) -> str:
    res = client.post("/api/v1/gate/scanners", json={"event_id": event_id, "gate_name": gate_name}, headers=headers)
    assert res.status_code == 201, res.text
    code = res.json()["enrollment_code"]
    res = client.post("/api/v1/gate/enroll", json={"enrollment_code": code, "device_id": device_id})
    assert res.status_code == 200, res.text
    return res.json()["device_token"]


# ── B1: gates — each ticket gets one gate, stored at purchase ────────────────

def _create_gated_event(headers: dict, gates: list[str], general_gate: str | None = "", vip_gate: str | None = "",
                        status: str = "live", expect: int = 201) -> dict:
    """An event with General and VIP tiers. Each tier's gate defaults to the
    first and last gate; pass None to leave one unset."""
    org = client.post("/api/v1/organisations/", json={"business_name": "Gate Test Org"}, headers=headers).json()
    res = client.post("/api/v1/events/", json={
        "organization_id": org["id"], "title": "Gate Test Event", "venue": "Test Venue",
        "event_date": "2027-05-01T18:00:00", "status": status,
        "gates": [{"name": g} for g in gates],
        "tiers": [
            {"name": "General", "price": 150, "capacity": 100, "visibility": "public",
             "gate": gates[0] if general_gate == "" else general_gate},
            {"name": "VIP", "price": 900, "capacity": 20, "visibility": "public",
             "gate": gates[-1] if vip_gate == "" else vip_gate},
        ],
    }, headers=headers)
    assert res.status_code == expect, res.text
    if expect != 201:
        return res.json()
    # The organiser console's view: it carries the gates and the full tier rows.
    console = client.get(f"/api/v1/organisations/{org['id']}/events/{res.json()['id']}", headers=headers)
    assert console.status_code == 200, console.text
    return console.json()


def _buy_tier(headers: dict, event: dict, tier_name: str, phone: str) -> str:
    tier = next(t for t in event["tiers"] if t["name"] == tier_name)
    res = client.post("/api/v1/payments/purchase", json={"event_id": event["id"], "tier_id": tier["id"], "phone_number": phone}, headers=headers)
    assert res.status_code == 201, res.text
    assert client.post(f"/api/v1/payments/{res.json()['payment_id']}/dev-confirm", headers=headers).status_code == 200
    return res.json()["ticket_id"]


def _sync(token: str, event_id: str) -> dict:
    res = client.get(f"/api/v1/gate/sync-event/{event_id}", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    return res.json()


def _own(sync: dict) -> set[str]:
    """The tickets this gate can admit: the ones it got secrets for."""
    return {t["id"] for t in sync["tickets"] if t["totp_secret"]}


def _gate_of(headers: dict, ticket_id: str) -> str | None:
    return client.get(f"/api/v1/tickets/{ticket_id}/detail", headers=headers).json()["gate_assignment"]


def test_each_tier_uses_its_gate_and_each_gate_gets_only_its_own():
    headers = _login("0799222001")
    event = _create_gated_event(headers, ["Gate A", "VIP Entrance"])
    general = [_buy_tier(headers, event, "General", "0799222001") for _ in range(3)]
    vip = [_buy_tier(headers, event, "VIP", "0799222001") for _ in range(2)]
    assert {_gate_of(headers, t) for t in general} == {"Gate A"}
    assert {_gate_of(headers, t) for t in vip} == {"VIP Entrance"}

    sync_a = _sync(_register_and_enroll(headers, event["id"], "device-gate-a", "Gate A"), event["id"])
    sync_v = _sync(_register_and_enroll(headers, event["id"], "device-gate-v", "VIP Entrance"), event["id"])
    assert _own(sync_a) == set(general) and _own(sync_v) == set(vip)
    assert sync_a["ticket_count"] == 3
    # Gate A's phone also knows the VIP tickets, without their secret, so it can redirect.
    others = [t for t in sync_a["tickets"] if not t["totp_secret"]]
    assert {t["id"] for t in others} == set(vip)
    assert all(t["gate_assignment"] == "VIP Entrance" for t in others)


def test_going_live_needs_a_gate_for_every_tier():
    headers = _login("0799222002")
    err = _create_gated_event(headers, ["Gate A", "Gate B"], vip_gate=None, expect=400)
    assert err["detail"] == 'Choose an entry gate for "VIP".'
    # A draft can wait; an event with one gate needs no choosing.
    _create_gated_event(headers, ["Gate A", "Gate B"], vip_gate=None, status="draft")
    single = _create_gated_event(headers, ["Main Entrance"], general_gate=None, vip_gate=None)
    assert {t["gate"] for t in single["tiers"]} == {"Main Entrance"}


def test_the_gate_is_fixed_and_shown_before_any_scanner_exists():
    headers = _login("0799222003")
    event = _create_gated_event(headers, ["North", "South"])
    ticket_id = _buy_tier(headers, event, "General", "0799222003")
    assert _gate_of(headers, ticket_id) == "North"
    mine = client.get("/api/v1/tickets/my", headers=headers).json()
    assert next(t for t in mine if t["id"] == ticket_id)["gate_name"] == "North"

    # Adding scanner phones (even at a new gate) doesn't move anyone.
    _register_and_enroll(headers, event["id"], "device-north", "North")
    _register_and_enroll(headers, event["id"], "device-east", "East")
    assert _gate_of(headers, ticket_id) == "North"


def test_renaming_a_gate_keeps_its_tickets_and_removing_one_needs_a_new_gate_for_its_tiers():
    headers = _login("0799222004")
    event = _create_gated_event(headers, ["Gate A", "Gate B", "Gate C"])
    vip = [_buy_tier(headers, event, "VIP", "0799222004") for _ in range(2)]
    token_c = _register_and_enroll(headers, event["id"], "device-rename-c", "Gate C")

    gates = event["gates"]
    renamed = [gates[0], gates[1], {"id": gates[2]["id"], "name": "Main Entrance"}]
    res = client.patch(f"/api/v1/events/{event['id']}", json={"gates": renamed}, headers=headers)
    assert res.status_code == 200, res.text
    assert all(_gate_of(headers, t) == "Main Entrance" for t in vip)
    assert _own(_sync(token_c, event["id"])) == set(vip)  # the phone followed its gate

    # Removing the VIP tier's gate: the organiser has to give VIP another.
    res = client.patch(f"/api/v1/events/{event['id']}", json={"gates": gates[:2]}, headers=headers)
    assert res.status_code == 400 and res.json()["detail"] == 'Choose an entry gate for "VIP".'
    tiers = [dict(t, gate="Gate A") for t in event["tiers"]]
    res = client.patch(f"/api/v1/events/{event['id']}", json={"gates": gates[:2], "tiers": tiers}, headers=headers)
    assert res.status_code == 200, res.text
    assert {_gate_of(headers, t) for t in vip} == {"Gate A"}
    # Down to one gate: every tier uses it, nothing to choose.
    res = client.patch(f"/api/v1/events/{event['id']}", json={"gates": [gates[1]]}, headers=headers)
    assert res.status_code == 200, res.text
    assert {_gate_of(headers, t) for t in vip} == {"Gate B"}


def test_changing_a_tiers_gate_moves_its_tickets():
    headers = _login("0799222005")
    event = _create_gated_event(headers, ["Gate A", "VIP Entrance"], vip_gate="Gate A")
    vip = _buy_tier(headers, event, "VIP", "0799222005")
    assert _gate_of(headers, vip) == "Gate A"
    tiers = [dict(t) for t in event["tiers"]]
    tiers[1]["gate"] = "VIP Entrance"
    res = client.patch(f"/api/v1/events/{event['id']}", json={"tiers": tiers}, headers=headers)
    assert res.status_code == 200, res.text
    assert _gate_of(headers, vip) == "VIP Entrance"

    tiers[1]["gate"] = "Nowhere"
    res = client.patch(f"/api/v1/events/{event['id']}", json={"tiers": tiers}, headers=headers)
    assert res.status_code == 400 and "isn't one of this event's gates" in res.json()["detail"]


def test_an_order_of_several_tickets_shares_one_gate():
    headers = _login("0799222008")
    event = _create_gated_event(headers, ["Gate A", "Gate B"])
    tier = next(t for t in event["tiers"] if t["name"] == "General")
    res = client.post("/api/v1/payments/purchase", json={"event_id": event["id"], "tier_id": tier["id"], "phone_number": "0799222008", "quantity": 3}, headers=headers)
    assert res.status_code == 201, res.text
    client.post(f"/api/v1/payments/{res.json()['payment_id']}/dev-confirm", headers=headers)
    mine = [t for t in client.get("/api/v1/tickets/my", headers=headers).json() if t["event_id"] == event["id"]]
    assert [t["gate_name"] for t in mine] == ["Gate A"] * 3


def test_receipt_email_names_the_gate():
    from app.services.email_service import purchase_receipt
    _, text, html = purchase_receipt(
        name="Amina", order_ref="AB12CD34", event_title="Gate Night", event_date=None, venue="KICC",
        tier_name="General", quantity=1, amount_kes=1000, mpesa_receipt="QK1", paid_at=None,
        phone="0712345678", resale=False, tickets_url="https://example.com/tickets", gate="VIP Entrance",
    )
    assert "Enter by" in text and "VIP Entrance" in text and "VIP Entrance" in html


def test_assignment_is_stable_across_repeated_syncs():
    headers = _login("0799222007")
    event = _create_gated_event(headers, ["Gate A", "Gate B"])
    for _ in range(6):
        _buy_tier(headers, event, "General", "0799222007")
    token_b = _register_and_enroll(headers, event["id"], "device-stable-b", "Gate B")
    assert _own(_sync(token_b, event["id"])) == _own(_sync(token_b, event["id"]))


# ── B5: scan reconciliation ──────────────────────────────────────────────────

def test_upload_records_admitted_and_denied_scans_with_reasons():
    headers = _login("0799222004")
    event = _create_org_and_event(headers, capacity=10)
    ticket_id = _buy_ticket(headers, event["id"], "0799222004")
    token = _register_and_enroll(headers, event["id"], "device-upload-1", "Main Gate")

    batch = {"scans": [
        {"ticket_id": ticket_id, "granted": True, "reason_code": "GRANTED", "scanned_at": "2027-05-01T19:00:00"},
        {"ticket_id": "nonexistent-ticket", "granted": False, "reason_code": "UNKNOWN_TICKET", "scanned_at": "2027-05-01T19:01:00"},
        {"ticket_id": "forged-but-admitted", "granted": True, "reason_code": "GRANTED", "scanned_at": "2027-05-01T19:02:00"},
    ]}
    res = client.post("/api/v1/gate/scan-upload", json=batch, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    results = {r["ticket_id"]: r for r in res.json()}
    assert results[ticket_id]["status"] == "recorded"
    assert results["nonexistent-ticket"]["status"] == "recorded"
    # An admission for a ticket that doesn't exist is reported, not stored.
    assert results["forged-but-admitted"]["status"] == "conflict"

    # Retrying the same batch doesn't double-record the unknown-ticket denial.
    retry = {r["ticket_id"]: r for r in client.post("/api/v1/gate/scan-upload", json=batch, headers={"Authorization": f"Bearer {token}"}).json()}
    assert retry["nonexistent-ticket"]["status"] == "duplicate"

    from app.models.models import Attendance, AttendanceStatus
    db = TestingSessionLocal()
    admitted = db.query(Attendance).filter(Attendance.ticket_id == ticket_id).first()
    assert admitted.status == AttendanceStatus.ADMITTED
    assert admitted.denial_reason is None
    # Unknown tickets have no ticket row to point at; the raw id is kept.
    denied = db.query(Attendance).filter(Attendance.scanned_ref == "nonexistent-ticket").first()
    assert denied.ticket_id is None
    assert denied.status == AttendanceStatus.DENIED
    assert denied.denial_reason == "UNKNOWN_TICKET"
    db.close()


def test_an_uploaded_admission_marks_the_ticket_used():
    """Same as an admission at the Organiser Console: the ticket is used,
    and a resale listing made after the device synced comes down."""
    from app.models.models import Ticket, TicketStatus, Transfer, TransferStatus, TransferType
    headers = _login("0799222010")
    event = _create_org_and_event(headers, capacity=10)
    ticket_id = _buy_ticket(headers, event["id"], "0799222010")
    token = _register_and_enroll(headers, event["id"], "device-used-1", "Main Gate")

    db = TestingSessionLocal()
    ticket = db.get(Ticket, ticket_id)
    ticket.status = TicketStatus.RESALE  # listed after the device synced
    db.add(Transfer(ticket_id=ticket_id, event_id=event["id"], seller_id=ticket.owner_id, transfer_type=TransferType.RESALE,
                    status=TransferStatus.LISTED, asking_price_kes=500))
    db.commit()
    db.close()

    batch = {"scans": [{"ticket_id": ticket_id, "granted": True, "reason_code": "GRANTED", "scanned_at": "2027-05-01T19:00:00"}]}
    res = client.post("/api/v1/gate/scan-upload", json=batch, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200 and res.json()[0]["status"] == "recorded", res.text

    db = TestingSessionLocal()
    ticket = db.get(Ticket, ticket_id)
    assert ticket.status == TicketStatus.USED
    assert ticket.used_at.isoformat().startswith("2027-05-01T19:00")
    assert ticket.gate_scanner_id
    assert db.query(Transfer).filter(Transfer.ticket_id == ticket_id).one().status == TransferStatus.CANCELLED
    db.close()


def test_upload_is_idempotent_on_retry_from_the_same_scanner():
    headers = _login("0799222005")
    event = _create_org_and_event(headers, capacity=10)
    ticket_id = _buy_ticket(headers, event["id"], "0799222005")
    token = _register_and_enroll(headers, event["id"], "device-upload-2", "Main Gate")

    payload = {"scans": [{"ticket_id": ticket_id, "granted": True, "reason_code": "GRANTED", "scanned_at": "2027-05-01T19:00:00"}]}
    first = client.post("/api/v1/gate/scan-upload", json=payload, headers={"Authorization": f"Bearer {token}"})
    second = client.post("/api/v1/gate/scan-upload", json=payload, headers={"Authorization": f"Bearer {token}"})

    assert first.json()[0]["status"] == "recorded"
    assert second.json()[0]["status"] == "duplicate"

    from app.models.models import Attendance
    db = TestingSessionLocal()
    count = db.query(Attendance).filter(Attendance.ticket_id == ticket_id).count()
    assert count == 1  # the retry must not have created a second row
    db.close()


def test_upload_reports_conflict_when_two_gates_admit_the_same_ticket():
    """Two offline gates both admitting the same ticket (Work Order 05's
    own example) must be reported, not silently deduplicated or
    overwritten."""
    headers = _login("0799222006")
    event = _create_org_and_event(headers, capacity=10)
    ticket_id = _buy_ticket(headers, event["id"], "0799222006")
    token_a = _register_and_enroll(headers, event["id"], "device-conflict-a", "Gate A")
    token_b = _register_and_enroll(headers, event["id"], "device-conflict-b", "Gate B")

    payload = {"scans": [{"ticket_id": ticket_id, "granted": True, "reason_code": "GRANTED", "scanned_at": "2027-05-01T19:00:00"}]}
    first = client.post("/api/v1/gate/scan-upload", json=payload, headers={"Authorization": f"Bearer {token_a}"})
    second = client.post("/api/v1/gate/scan-upload", json=payload, headers={"Authorization": f"Bearer {token_b}"})

    assert first.json()[0]["status"] == "recorded"
    assert second.json()[0]["status"] == "conflict"
    assert "Already admitted" in second.json()[0]["detail"]

    from app.models.models import Attendance
    db = TestingSessionLocal()
    count = db.query(Attendance).filter(Attendance.ticket_id == ticket_id).count()
    assert count == 1  # the conflicting second admit must not be written as a second row
    db.close()


def test_scan_upload_requires_device_token():
    res = client.post("/api/v1/gate/scan-upload", json={"scans": []})
    assert res.status_code == 403  # HTTPBearer with no Authorization header
