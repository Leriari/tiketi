"""
The attendee journey after checkout: profile (name + email), the receipt
email being queued, the ticket page's details, giving a ticket to a friend,
and checking a ticket against the blockchain.
"""
import uuid

import pytest

from app.core.config import get_settings
from app.models.models import Ticket
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
    from app.worker import mark_ticket_used_onchain, mint_ticket_nft

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": "m", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)
    monkeypatch.setattr(mark_ticket_used_onchain, "delay", lambda *a, **kw: None)


def _event_and_ticket(phone: str, title: str):
    owner = _login(phone)
    org = client.post(f"{API}/organisations/", json={"business_name": f"{title} Ltd"}, headers=owner).json()
    event = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": title, "venue": "KICC", "event_date": "2027-08-01T18:00",
        "ticket_price_kes": 750, "total_capacity": 30,
    }, headers=owner).json()
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": phone, "quantity": 1}, headers=owner).json()
    assert client.post(f"{API}/payments/{pay['payment_id']}/dev-confirm", headers=owner).status_code == 200
    ticket_id = client.get(f"{API}/tickets/my", headers=owner).json()[0]["id"]
    return owner, org, event, pay["payment_id"], ticket_id


def test_profile_needs_name_and_email():
    me = _login("0788700001")
    p = client.get(f"{API}/me/profile", headers=me).json()["user"]
    assert p["profile_complete"] is False

    assert client.patch(f"{API}/me/profile", json={"email": "not-an-email"}, headers=me).status_code == 422
    res = client.patch(f"{API}/me/profile", json={"display_name": "Achieng Odhiambo", "email": " Achieng@Example.com "}, headers=me)
    assert res.status_code == 200
    user = res.json()["user"]
    assert user["email"] == "achieng@example.com" and user["email_verified"] is False and user["profile_complete"] is True

    other = _login("0788700002")
    taken = client.patch(f"{API}/me/profile", json={"email": "ACHIENG@example.com"}, headers=other)
    assert taken.status_code == 409


def test_receipt_is_queued_when_email_is_set_up(monkeypatch):
    from app.api.routes import payments
    from app.worker import send_payment_receipt

    queued = []
    monkeypatch.setattr(send_payment_receipt, "delay", lambda pid, **kw: queued.append(pid))
    settings = payments.settings  # the object the route reads (other tests may replace get_settings()'s)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_USERNAME", "sender@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "x")
    assert payments.settings.EMAIL_CONFIGURED

    _, _, _, payment_id, ticket_id = _event_and_ticket("0788700003", "Receipt Night")
    assert queued == [payment_id]


def test_ticket_detail_has_status_payment_and_chain_links():
    owner, _, event, payment_id, ticket_id = _event_and_ticket("0788700004", "Detail Gig")
    d = client.get(f"{API}/tickets/{ticket_id}/detail", headers=owner).json()
    assert d["status"] == "active" and d["admitted_at"] is None
    assert d["payment"]["id"] == payment_id and d["payment"]["amount_kes"] == 750
    assert d["chain_status"] == "pending" and d["chain"]["token_id"] is None
    assert d["self_custodied"] is False
    assert client.get(f"{API}/tickets/{ticket_id}/onchain", headers=owner).status_code == 409  # not minted yet


def test_giving_a_ticket_to_a_friend():
    owner, _, event, _, ticket_id = _event_and_ticket("0788700005", "Gift Gig")
    db = TestingSessionLocal()
    old_qr = build_qr_payload(ticket_id, db.get(Ticket, ticket_id).totp_secret)
    db.close()

    nobody = client.post(f"{API}/tickets/{ticket_id}/transfer", json={"recipient": "0788700999"}, headers=owner)
    assert nobody.status_code == 404 and "sign up" in nobody.json()["detail"]
    assert client.post(f"{API}/tickets/{ticket_id}/transfer", json={"recipient": "0788700005"}, headers=owner).status_code == 400

    friend = _login("0788700006")
    client.patch(f"{API}/me/profile", json={"display_name": "Wanjiru Kamau", "email": "wanjiru@example.com"}, headers=friend)
    res = client.post(f"{API}/tickets/{ticket_id}/transfer", json={"recipient": "WANJIRU@example.com"}, headers=owner)
    assert res.status_code == 200 and res.json()["recipient_name"] == "Wanjiru Kamau"

    assert client.get(f"{API}/tickets/{ticket_id}/detail", headers=owner).status_code == 404
    assert client.get(f"{API}/tickets/{ticket_id}/detail", headers=friend).json()["status"] == "active"
    new_qr = client.get(f"{API}/tickets/{ticket_id}/seed", headers=friend).json()["qr_payload"]
    assert new_qr != old_qr  # the giver's QR stopped working

    gave = [i["kind"] for i in client.get(f"{API}/me/activity", headers=owner).json()["items"]]
    got = [i["kind"] for i in client.get(f"{API}/me/activity", headers=friend).json()["items"]]
    assert "gift_sent" in gave and "gift_received" in got


def test_used_ticket_explains_itself():
    owner, org, event, _, ticket_id = _event_and_ticket("0788700007", "Used Gig")
    db = TestingSessionLocal()
    qr = build_qr_payload(ticket_id, db.get(Ticket, ticket_id).totp_secret)
    db.close()
    assert client.post(f"{API}/organisations/{org['id']}/events/{event['id']}/scan", json={"qr_payload": qr}, headers=owner).json()["valid"]
    d = client.get(f"{API}/tickets/{ticket_id}/detail", headers=owner).json()
    assert d["status"] == "used" and d["admitted_at"]
    seed = client.get(f"{API}/tickets/{ticket_id}/seed", headers=owner)
    assert seed.status_code == 400 and "already been used" in seed.json()["detail"]
    assert client.post(f"{API}/tickets/{ticket_id}/transfer", json={"recipient": "0788700001"}, headers=owner).status_code == 400


def test_onchain_check_reads_the_real_contract():
    settings = get_settings()
    if not settings.BLOCKCHAIN_CONFIGURED:
        pytest.skip("needs the local Hardhat node from conftest")
    from app.services import web3_service

    owner, _, event, _, ticket_id = _event_and_ticket("0788700008", "Chain Gig")
    db = TestingSessionLocal()
    ticket = db.get(Ticket, ticket_id)
    token_id, tx_hash = web3_service.mint_ticket_onchain(
        event_id=ticket.event_id, tier_id=ticket.tier_id, face_price_kes=750, resale_floor_bps=10000, resale_cap_bps=12000, royalty_bps=1000,
    )
    ticket.nft_token_id, ticket.nft_tx_hash = token_id, tx_hash
    ticket.nft_contract_address = web3_service.settings.NFT_CONTRACT_ADDRESS
    db.commit()
    db.close()

    res = client.get(f"{API}/tickets/{ticket_id}/onchain", headers=owner)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["all_passed"] is True, body["checks"]
    assert body["token_id"] == token_id and body["face_price_kes"] == 750 and body["minted_block"]
    detail = client.get(f"{API}/tickets/{ticket_id}/detail", headers=owner).json()
    assert detail["chain"]["mint_tx_url"].endswith(tx_hash)
