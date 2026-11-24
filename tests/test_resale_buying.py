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
from app.services.mpesa import stk_callback_path

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

    async def fake_query(checkout_request_id):
        return {"ResponseCode": "0", "ResultCode": "0", "ResultDesc": "The service request is processed successfully."}

    monkeypatch.setattr(mpesa_svc, "query_stk_status", fake_query)
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
    client.post(stk_callback_path(payment_id), json={"Body": {"stkCallback": {
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
    client.post(stk_callback_path(payment_id), json=body)
    client.post(stk_callback_path(payment_id), json=body)  # Daraja retry
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


# ── Paying by card (Paystack) and from the ChainTix wallet ──────────────────

def _user_id(headers) -> str:
    return client.get(f"{API}/me/profile", headers=headers).json()["user"]["id"]


def _fund_wallet(headers, amount, *, available=True):
    """Give a user an earned resale balance: available now, or still in escrow."""
    from app.models.models import WalletTransaction, WalletTransactionType
    db = TestingSessionLocal()
    try:
        db.add(WalletTransaction(
            user_id=_user_id(headers), type=WalletTransactionType.SALE, description="Resale · test",
            amount_kes=amount,
            available_at=datetime.utcnow() + (timedelta(days=-1) if available else timedelta(days=5)),
        ))
        db.commit()
    finally:
        db.close()


def _wallet(headers) -> dict:
    return client.get(f"{API}/resale/wallet", headers=headers).json()


def _transfer_status(listing_id):
    db = TestingSessionLocal()
    try:
        return db.query(Transfer).filter(Transfer.id == listing_id).one().status
    finally:
        db.close()


def test_buy_with_wallet_balance(people, event):
    from app.models.models import WalletTransaction, WalletTransactionType
    listing_id = _seller_listing(people, event, price=1100)
    _fund_wallet(people["buyer"], 1500)
    before = _wallet(people["buyer"])["available"]
    db = TestingSessionLocal()
    try:
        sold_before = db.query(Event).filter(Event.id == event["id"]).one().tickets_sold
    finally:
        db.close()

    res = client.post(f"{API}/resale/listings/{listing_id}/buy", json={"method": "wallet"}, headers=people["buyer"])
    assert res.status_code == 201, res.text
    assert res.json()["method"] == "wallet"
    payment_id = res.json()["payment_id"]

    # Paid at once: straight on to moving the ticket, no prompt to wait for.
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()["status"] == "transferring"
    assert _transfer_status(listing_id) == TransferStatus.PAID
    wallet = _wallet(people["buyer"])
    assert wallet["available"] == before - 1100
    spend = next(t for t in wallet["transactions"] if t["type"] == "purchase")
    assert spend["amount"] == -1100

    db = TestingSessionLocal()
    try:
        payment = db.query(Payment).filter(Payment.id == payment_id).one()
        assert payment.method == "wallet" and payment.paid_with == "ChainTix wallet" and payment.reference is None
        # A resale moves an existing ticket; it isn't a new sale for the event.
        assert db.query(Event).filter(Event.id == event["id"]).one().tickets_sold == sold_before
        assert db.query(WalletTransaction).filter(WalletTransaction.type == WalletTransactionType.PURCHASE,
                                                  WalletTransaction.transfer_id == listing_id).count() == 1
    finally:
        db.close()


def test_wallet_must_cover_the_price(people, event):
    listing_id = _seller_listing(people, event, price=1100)
    available = _wallet(people["buyer2"])["available"]
    # Money still in escrow can't be spent.
    _fund_wallet(people["buyer2"], 5000, available=False)

    res = client.post(f"{API}/resale/listings/{listing_id}/buy", json={"method": "wallet"}, headers=people["buyer2"])
    assert res.status_code == 400 and "wallet balance" in res.json()["detail"]
    assert _transfer_status(listing_id) == TransferStatus.LISTED
    assert _wallet(people["buyer2"])["available"] == available


def test_mpesa_still_needs_a_phone_number(people, event):
    listing_id = _seller_listing(people, event)
    res = client.post(f"{API}/resale/listings/{listing_id}/buy", json={"method": "mpesa"}, headers=people["buyer"])
    assert res.status_code == 422


@pytest.fixture
def card(monkeypatch, people):
    from tests.test_card_payments import FakePaystack, SECRET
    from app.api.routes import payments
    from app.services import paystack_service
    from app.core.config import get_settings
    from app.models.models import User

    fake = FakePaystack()
    monkeypatch.setattr(paystack_service, "initialize_transaction", fake.initialize)
    monkeypatch.setattr(paystack_service, "verify_transaction", fake.verify)
    for settings in {id(s): s for s in (payments.settings, paystack_service.settings, get_settings())}.values():
        monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", SECRET)
    db = TestingSessionLocal()
    try:  # Paystack needs an email for its receipt.
        db.query(User).filter(User.id == _user_id(people["buyer"])).update({"email": "resale.buyer@example.com"})
        db.commit()
    finally:
        db.close()
    return fake


def _buy_by_card(people, listing_id, who="buyer"):
    return client.post(f"{API}/resale/listings/{listing_id}/buy", json={"method": "card"}, headers=people[who])


def test_buy_by_card(people, event, card):
    listing_id = _seller_listing(people, event, price=1150)
    res = _buy_by_card(people, listing_id)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["method"] == "card" and body["checkout_url"].startswith("https://checkout.paystack.com/")
    payment_id = body["payment_id"]
    # Paystack sends the buyer back to this listing's checkout.
    assert f"/resale/{listing_id}?payment={payment_id}&card=done" in card.initialized[-1]["callback_url"]
    assert card.initialized[-1]["amount_kes"] == 1150

    # Held for them while they're on Paystack's page.
    assert _buy(people, listing_id, "buyer2").status_code == 409
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()["status"] == "awaiting_payment"

    card.pay(payment_id)
    # The buyer's poll asks Paystack, which confirms it.
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()["status"] == "transferring"
    assert _transfer_status(listing_id) == TransferStatus.PAID
    db = TestingSessionLocal()
    try:
        assert db.query(Payment).filter(Payment.id == payment_id).one().paid_with == "Visa •••• 4081"
    finally:
        db.close()


def test_card_hold_outlasts_an_mpesa_prompt(people, event, card):
    listing_id = _seller_listing(people, event)
    payment_id = _buy_by_card(people, listing_id).json()["payment_id"]

    def age(minutes):
        db = TestingSessionLocal()
        try:
            db.query(Payment).filter(Payment.id == payment_id).update(
                {"initiated_at": datetime.utcnow() - timedelta(minutes=minutes)})
            db.commit()
        finally:
            db.close()

    age(6)  # an M-Pesa purchase would have been released by now
    assert client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()["status"] == "awaiting_payment"
    age(31)
    status = client.get(f"{API}/resale/purchases/{payment_id}", headers=people["buyer"]).json()
    assert status["status"] == "failed" and "card payment" in status["failure_reason"]
    assert _transfer_status(listing_id) == TransferStatus.LISTED


def test_cancelling_on_paystack_puts_the_listing_back(people, event, card):
    listing_id = _seller_listing(people, event)
    payment_id = _buy_by_card(people, listing_id).json()["payment_id"]
    res = client.post(f"{API}/payments/{payment_id}/cancel", headers=people["buyer"])
    assert res.status_code == 200 and res.json()["status"] == "failed"
    assert _transfer_status(listing_id) == TransferStatus.LISTED
    assert _buy(people, listing_id, "buyer2").status_code == 201


def test_fees_never_round_up():
    from app.services.platform_settings import resale_fee_split
    # KES 12: 10% is 1.2 and 5% is 0.6. Rounded down, the 5% fee can't
    # come out the same as the 10% royalty.
    assert resale_fee_split(12, 10, 5) == (1, 0, 11)
    assert resale_fee_split(1100, 10, 5) == (110, 55, 935)
    for price in range(1, 500):
        royalty, fee, payout = resale_fee_split(price, 10, 5)
        assert royalty <= price * 0.10 and fee <= price * 0.05
        assert royalty + fee + payout == price
