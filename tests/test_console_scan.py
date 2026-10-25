"""
Live QR Scanner in the Organiser Console (POST /organisations/{org}/events/
{event}/scan): staff-only, rejects tickets for other events, and records
every decision as attendance.
"""
import uuid

import pytest

from app.models.models import Attendance, AttendanceStatus, Ticket
from app.services.totp_service import build_qr_payload
from tests.test_api import TestingSessionLocal, client

API = "/api/v1"


def _login(phone: str) -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
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


def _event(owner: dict, org_id: str, title: str) -> str:
    res = client.post(f"{API}/events/", json={
        "organization_id": org_id, "title": title, "venue": "KICC", "event_date": "2027-07-01T18:00",
        "ticket_price_kes": 300, "total_capacity": 20,
    }, headers=owner)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _ticket_qr(buyer: dict, phone: str, event_id: str) -> tuple[str, str]:
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event_id, "phone_number": phone, "quantity": 1}, headers=buyer).json()
    client.post(f"{API}/payments/{pay['payment_id']}/dev-confirm", headers=buyer)
    db = TestingSessionLocal()
    ticket = db.query(Ticket).filter(Ticket.event_id == event_id).order_by(Ticket.created_at.desc()).first()
    qr = build_qr_payload(ticket.id, ticket.totp_secret)
    db.close()
    return ticket.id, qr


def test_console_scan_admits_once_and_records_attendance():
    owner = _login("0777600001")
    org = client.post(f"{API}/organisations/", json={"business_name": "Scan Test Co"}, headers=owner).json()
    gig = _event(owner, org["id"], "Scan Gig")
    other = _event(owner, org["id"], "Other Gig")
    ticket_id, qr = _ticket_qr(owner, "0777600001", gig)
    url = f"{API}/organisations/{org['id']}/events/{gig}/scan"

    assert client.post(url, json={"qr_payload": qr}).status_code in (401, 403)  # staff only
    assert client.post(url, json={"qr_payload": qr}, headers=_login("0777600002")).status_code == 403

    wrong = client.post(f"{API}/organisations/{org['id']}/events/{other}/scan", json={"qr_payload": qr}, headers=owner).json()
    assert wrong["valid"] is False and wrong["code"] == "WRONG_EVENT" and "Scan Gig" in wrong["reason"]

    junk = client.post(url, json={"qr_payload": "https://example.com"}, headers=owner).json()
    assert junk["code"] == "INVALID_FORMAT"

    first = client.post(url, json={"qr_payload": qr}, headers=owner).json()
    assert first["valid"] is True and first["ticket_id"] == ticket_id and first["scanned_at"].endswith("Z")

    again = client.post(url, json={"qr_payload": qr}, headers=owner).json()
    assert again["valid"] is False and again["code"] == "ALREADY_ADMITTED" and again["used_at"]

    forged = client.post(url, json={"qr_payload": f"TIKETI:{ticket_id}:000000"}, headers=owner).json()
    assert forged["code"] in ("BAD_OTP", "ALREADY_ADMITTED")

    db = TestingSessionLocal()
    rows = db.query(Attendance).filter(Attendance.ticket_id == ticket_id).all()
    db.close()
    assert sum(r.status == AttendanceStatus.ADMITTED for r in rows) == 1
    assert {r.denial_reason for r in rows if r.status == AttendanceStatus.DENIED} >= {"WRONG_EVENT", "ALREADY_ADMITTED"}
