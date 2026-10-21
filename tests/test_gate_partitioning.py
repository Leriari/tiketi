"""
Work Order 05 B1 (gate partitioning) + B5 (scan reconciliation) tests.

Reuses test_api.py's TestClient/DB setup, same reasoning as the other
cross-file test modules in this suite.
"""
from tests.test_api import client, TestingSessionLocal


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


# ── B1: gate partitioning ────────────────────────────────────────────────────

def test_two_gates_partition_tickets_with_no_overlap():
    headers = _login("0799222001")
    event = _create_org_and_event(headers, capacity=50)

    ticket_ids = [_buy_ticket(headers, event["id"], "0799222001") for _ in range(20)]

    token_a = _register_and_enroll(headers, event["id"], "device-gate-a", "Gate A")
    token_b = _register_and_enroll(headers, event["id"], "device-gate-b", "Gate B")

    sync_a = client.get(f"/api/v1/gate/sync-event/{event['id']}", headers={"Authorization": f"Bearer {token_a}"}).json()
    sync_b = client.get(f"/api/v1/gate/sync-event/{event['id']}", headers={"Authorization": f"Bearer {token_b}"}).json()

    ids_a = {t["id"] for t in sync_a["tickets"]}
    ids_b = {t["id"] for t in sync_b["tickets"]}

    # No overlap — the central claim of partitioning.
    assert ids_a.isdisjoint(ids_b)
    # Every ticket went somewhere — the union covers all of them.
    assert ids_a | ids_b == set(ticket_ids)
    # Both gates got at least one ticket with 20 tickets split 2 ways —
    # not a strict guarantee of the hash, but exceedingly likely, and a
    # real smoke test that the split isn't degenerate (e.g. everything on
    # one gate).
    assert len(ids_a) > 0 and len(ids_b) > 0

    for t in sync_a["tickets"]:
        assert t["gate_assignment"] == "Gate A"
    for t in sync_b["tickets"]:
        assert t["gate_assignment"] == "Gate B"


def test_single_gate_still_gets_every_ticket():
    """With only one gate registered, partitioning degenerates to the old
    device-level-only behaviour — every ticket assigned to the one gate
    that exists."""
    headers = _login("0799222002")
    event = _create_org_and_event(headers, capacity=10)
    ticket_ids = [_buy_ticket(headers, event["id"], "0799222002") for _ in range(5)]

    token = _register_and_enroll(headers, event["id"], "device-single", "Only Gate")
    sync = client.get(f"/api/v1/gate/sync-event/{event['id']}", headers={"Authorization": f"Bearer {token}"}).json()

    assert {t["id"] for t in sync["tickets"]} == set(ticket_ids)


def test_assignment_is_stable_across_repeated_syncs():
    """The same device syncing twice (nothing about the gate set changed)
    gets the exact same ticket set both times — a device re-syncing
    mid-event must not have tickets silently reshuffle away from it."""
    headers = _login("0799222003")
    event = _create_org_and_event(headers, capacity=30)
    for _ in range(12):
        _buy_ticket(headers, event["id"], "0799222003")

    _register_and_enroll(headers, event["id"], "device-stable-a", "Gate A")
    token_b = _register_and_enroll(headers, event["id"], "device-stable-b", "Gate B")

    first = client.get(f"/api/v1/gate/sync-event/{event['id']}", headers={"Authorization": f"Bearer {token_b}"}).json()
    second = client.get(f"/api/v1/gate/sync-event/{event['id']}", headers={"Authorization": f"Bearer {token_b}"}).json()

    assert {t["id"] for t in first["tickets"]} == {t["id"] for t in second["tickets"]}


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
