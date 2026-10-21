"""
Buying on the resale marketplace: what's listed, buy-time rules, purchases
that never complete, the buyer's purchase status, and M-Pesa callbacks that
arrive twice or late.

Listings are inserted straight into the test DB (as if listForResale had
already succeeded on-chain), and the STK push / settlement task are stubbed,
so none of this needs the local chain or the real Daraja sandbox — unlike
test_resale.py, which exercises the on-chain cap itself.
"""
import uuid
from datetime import datetime, timedelta

import pytest

from tests.test_api import client, TestingSessionLocal
from app.models.models import Transfer, TransferStatus, TransferType, Ticket, TicketStatus, Payment, Event

API = "/api/v1"


def _login(phone: str) -> dict:
    res = client.post(f"{API}/auth/login", json={"phone_number": phone})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft, settle_resale_transfer

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": f"m-{uuid.uuid4().hex[:8]}", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)
    monkeypatch.setattr(settle_resale_transfer, "delay", lambda *a, **kw: None)


@pytest.fixture(scope="module")
def people():
    return {"organiser": _login("0744300001"), "seller": _login("0744300002"),
            "buyer": _login("0744300003"), "buyer2": _login("0744300004")}


@pytest.fixture(scope="module")
def event(people):
    org = client.post(f"{API}/organisations/", json={"business_name": "Resale Buying Org"}, headers=people["organiser"]).json()
    res = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Resale Buying Gig", "venue": "Venue",
        "event_date": (datetime.utcnow() + timedelta(days=30)).isoformat(timespec="minutes"),
        "ticket_price_kes": 1000, "total_capacity": 50, "max_resale_multiplier": 1.2,
    }, headers=people["organiser"])
    assert res.status_code == 201, res.text
    return {**res.json(), "organization_id": org["id"]}


def _seller_listing(people, event, price=1100) -> str:
    """Seller buys a ticket (primary), then it's listed for resale."""
    res = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0744300002"}, headers=people["seller"])
    assert res.status_code == 201, res.text
    client.post(f"{API}/payments/{res.json()['payment_id']}/dev-confirm", headers=people["seller"])
    db = TestingSessionLocal()
    try:
        ticket = db.query(Ticket).filter(Ticket.id == res.json()["ticket_id"]).one()
        ticket.nft_token_id = 900_000 + db.query(Transfer).count()
        ticket.status = TicketStatus.RESALE
        transfer = Transfer(ticket_id=ticket.id, event_id=ticket.event_id, seller_id=ticket.owner_id,
                            transfer_type=TransferType.RESALE, status=TransferStatus.LISTED, asking_price_kes=price)
        db.add(transfer)
        db.commit()
        return transfer.id
    finally:
        db.close()


def _buy(people, listing_id, who="buyer"):
    return client.post(f"{API}/resale/listings/{listing_id}/buy", json={"phone_number": "0744300003"}, headers=people[who])


def test_listing_shows_up_with_face_value(people, event):
    listing_id = _seller_listing(people, event, price=1150)
    rows = client.get(f"{API}/resale/listings", params={"event_id": event["id"]}).json()
    row = next(r for r in rows if r["id"] == listing_id)
    assert row["price"] == 1150 and row["face_value_kes"] == 1000
    assert row["resale_ceiling_kes"] == 1200
    detail = client.get(f"{API}/resale/listings/{listing_id}").json()
    assert detail["buyable"] is True and detail["unavailable_reason"] is None


def test_listings_are_sorted_cheapest_first(people, event):
    _seller_listing(people, event, price=1010)
    prices = [r["price"] for r in client.get(f"{API}/resale/listings", params={"event_id": event["id"]}).json()]
    assert prices == sorted(prices)


def test_buyer_follows_purchase_from_payment_to_ticket(people, event):
    listing_id = _seller_listing(people, event)
    res = _buy(people, listing_id)
    assert res.status_code == 201, res.text
    payment_id = res.json()["payment_id"]

    status = client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()
    assert status["status"] == "awaiting_payment"
    # Someone else can't buy it while the first buyer is paying.
    assert _buy(people, listing_id, "buyer2").status_code == 409
    # And it's not listed for others meanwhile.
    assert listing_id not in [r["id"] for r in client.get(f"{API}/resale/listings").json()]

    client.post(f"{API}/payments/{payment_id}/dev-confirm", headers=people["buyer"])
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()["status"] == "transferring"

    db = TestingSessionLocal()
    try:  # what settle_resale_transfer does once the chain confirms
        db.query(Transfer).filter(Transfer.id == listing_id).update({"status": TransferStatus.COMPLETED})
        db.commit()
    finally:
        db.close()
    done = client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()
    assert done["status"] == "complete" and done["ticket_id"]

    # Purchases are private to the buyer.
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer2"]).status_code == 404


def test_unpaid_purchase_is_released_and_late_callback_ignored(people, event):
    listing_id = _seller_listing(people, event)
    payment_id = _buy(people, listing_id).json()["payment_id"]

    db = TestingSessionLocal()
    try:
        payment = db.query(Payment).filter(Payment.id == payment_id).one()
        payment.initiated_at = datetime.utcnow() - timedelta(minutes=6)
        checkout_id = payment.checkout_request_id
        ticket_id = payment.ticket_id
        sold_before = db.query(Event).filter(Event.id == event["id"]).one().tickets_sold
        db.commit()
    finally:
        db.close()

    # Back on sale for everyone, and the buyer is told why.
    assert listing_id in [r["id"] for r in client.get(f"{API}/resale/listings").json()]
    status = client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()
    assert status["status"] == "failed" and "in time" in status["failure_reason"]

    # A success callback arriving after that changes nothing.
    client.post(f"{API}/payments/mpesa/callback", json={"Body": {"stkCallback": {
        "MerchantRequestID": "m", "CheckoutRequestID": checkout_id, "ResultCode": 0, "ResultDesc": "OK",
        "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": 1100}, {"Name": "MpesaReceiptNumber", "Value": "LATE123"}]},
    }}})
    db = TestingSessionLocal()
    try:
        assert db.query(Transfer).filter(Transfer.id == listing_id).one().status == TransferStatus.LISTED
        assert db.query(Ticket).filter(Ticket.id == ticket_id).one().status == TicketStatus.RESALE
        assert db.query(Event).filter(Event.id == event["id"]).one().tickets_sold == sold_before
    finally:
        db.close()

    # Someone else can now buy it.
    assert _buy(people, listing_id, "buyer2").status_code == 201


def test_duplicate_primary_callback_counts_once(people, event):
    res = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0744300003"}, headers=people["buyer"])
    payment_id = res.json()["payment_id"]
    db = TestingSessionLocal()
    try:
        checkout_id = db.query(Payment).filter(Payment.id == payment_id).one().checkout_request_id
        sold_before = db.query(Event).filter(Event.id == event["id"]).one().tickets_sold
    finally:
        db.close()
    body = {"Body": {"stkCallback": {
        "MerchantRequestID": "m", "CheckoutRequestID": checkout_id, "ResultCode": 0, "ResultDesc": "OK",
        "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": 1000}, {"Name": "MpesaReceiptNumber", "Value": "DUP123"}]},
    }}}
    client.post(f"{API}/payments/mpesa/callback", json=body)
    client.post(f"{API}/payments/mpesa/callback", json=body)  # Daraja retry
    db = TestingSessionLocal()
    try:
        assert db.query(Event).filter(Event.id == event["id"]).one().tickets_sold == sold_before + 1
    finally:
        db.close()


def test_organiser_rules_apply_when_buying(people, event):
    listing_id = _seller_listing(people, event)
    res = client.patch(f"{API}/events/{event['id']}", json={"resale_enabled": False}, headers=people["organiser"])
    assert res.status_code == 200, res.text
    try:
        assert listing_id not in [r["id"] for r in client.get(f"{API}/resale/listings").json()]
        detail = client.get(f"{API}/resale/listings/{listing_id}").json()
        assert detail["buyable"] is False and "turned off resale" in detail["unavailable_reason"]
        res = _buy(people, listing_id)
        assert res.status_code == 400 and "turned off resale" in res.json()["detail"]
    finally:
        client.patch(f"{API}/events/{event['id']}", json={"resale_enabled": True}, headers=people["organiser"])


def test_cannot_buy_own_listing(people, event):
    listing_id = _seller_listing(people, event)
    res = client.post(f"{API}/resale/listings/{listing_id}/buy", json={"phone_number": "0744300002"}, headers=people["seller"])
    assert res.status_code == 400


def test_same_buyer_can_retry_a_timed_out_prompt(people, event):
    listing_id = _seller_listing(people, event)
    first = _buy(people, listing_id).json()["payment_id"]
    retry = _buy(people, listing_id)
    assert retry.status_code == 201, retry.text
    second = retry.json()["payment_id"]
    assert second != first
    assert client.get(f"{API}/resale/purchases/{first}", headers=people["buyer"]).json()["status"] == "failed"
    assert client.get(f"{API}/resale/purchases/{second}", headers=people["buyer"]).json()["status"] == "awaiting_payment"
    # A different buyer still can't jump in.
    assert _buy(people, listing_id, "buyer2").status_code == 409
