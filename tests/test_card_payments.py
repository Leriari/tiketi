"""
Card payments through Paystack Checkout, with Paystack itself faked: the
transaction it would open, the buyer paying (or cancelling) on its page,
the status poll and the signed webhook both confirming — and only one of
them taking effect.
"""
import hashlib
import hmac
import json
import uuid

import pytest

from app.models.models import Event, Payment, Ticket, TicketStatus
from tests.test_api import TestingSessionLocal, client

API = "/api/v1"
SECRET = "sk_test_fake_paystack_key"


def _login(phone: str, email: str | None = None) -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    if email:
        client.patch(f"{API}/me/profile", json={"display_name": "Card Buyer", "email": email}, headers=headers)
    return headers


class FakePaystack:
    def __init__(self):
        self.transactions = {}
        self.initialized = []

    def initialize(self, *, reference, amount_kes, email, description, callback_url, cancel_url):
        self.transactions[reference] = {"id": 4099260516, "reference": reference, "status": "abandoned",
                                        "amount": round(amount_kes * 100), "currency": "KES", "authorization": {}}
        self.initialized.append({"reference": reference, "amount_kes": amount_kes, "email": email,
                                 "callback_url": callback_url, "cancel_url": cancel_url})
        return {"authorization_url": f"https://checkout.paystack.com/{uuid.uuid4().hex[:14]}",
                "access_code": "x", "reference": reference}

    def verify(self, reference):
        return self.transactions[reference]

    def pay(self, reference, amount=None):
        txn = self.transactions[reference]
        txn.update(status="success", authorization={"last4": "4081", "brand": "visa", "card_type": "visa "})
        if amount is not None:
            txn["amount"] = amount


@pytest.fixture
def paystack(monkeypatch):
    from app.api.routes import payments
    from app.services import paystack_service
    from app.worker import mint_ticket_nft, send_payment_receipt

    fake = FakePaystack()
    monkeypatch.setattr(paystack_service, "initialize_transaction", fake.initialize)
    monkeypatch.setattr(paystack_service, "verify_transaction", fake.verify)
    # The objects these modules read (other tests may replace get_settings()'s).
    for settings in {id(payments.settings): payments.settings, id(paystack_service.settings): paystack_service.settings}.values():
        monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", SECRET)
    fake.minted = []
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda tid, **kw: fake.minted.append(tid))
    monkeypatch.setattr(send_payment_receipt, "delay", lambda *a, **kw: None)
    return fake


def _event(owner: dict, title: str, price: int = 750) -> dict:
    org = client.post(f"{API}/organisations/", json={"business_name": f"{title} Ltd"}, headers=owner).json()
    return client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": title, "venue": "KICC", "event_date": "2027-09-01T18:00",
        "ticket_price_kes": price, "total_capacity": 30,
    }, headers=owner).json()


def _buy_by_card(headers: dict, event_id: str, quantity: int = 1):
    return client.post(f"{API}/payments/purchase", json={"event_id": event_id, "method": "card", "quantity": quantity}, headers=headers)


def _sold(event_id: str) -> int:
    db = TestingSessionLocal()
    try:
        return db.get(Event, event_id).tickets_sold
    finally:
        db.close()


def _signed(payload: dict, secret: str = SECRET) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    return body, {"x-paystack-signature": sig, "Content-Type": "application/json"}


def test_card_purchase_opens_paystack_and_the_status_poll_confirms_it(paystack):
    buyer = _login("0788800001", "card1@example.com")
    event = _event(buyer, "Card Night", price=15)  # cheap tickets are fine on Paystack
    res = _buy_by_card(buyer, event["id"], quantity=2)
    assert res.status_code == 201, res.text
    body = res.json()
    pid = body["payment_id"]
    assert body["method"] == "card" and body["checkout_url"].startswith("https://checkout.paystack.com/")
    init = paystack.initialized[0]
    assert init["reference"] == pid and init["amount_kes"] == 30 and init["email"] == "card1@example.com"
    assert f"payment={pid}" in init["callback_url"] and init["cancel_url"].endswith("card=cancelled")

    assert client.get(f"{API}/payments/{pid}/status", headers=buyer).json()["status"] == "initiated"

    paystack.pay(pid)
    status = client.get(f"{API}/payments/{pid}/status", headers=buyer).json()
    assert status["status"] == "success" and status["method"] == "card" and status["paid_with"] == "Visa •••• 4081"
    assert status["ticket_id"] == body["ticket_id"]
    assert sorted(paystack.minted) == sorted(body["ticket_ids"])
    assert _sold(event["id"]) == 2

    # Polling again (or the webhook arriving late) changes nothing.
    client.get(f"{API}/payments/{pid}/status", headers=buyer)
    assert _sold(event["id"]) == 2 and len(paystack.minted) == 2

    detail = client.get(f"{API}/tickets/{body['ticket_id']}/detail", headers=buyer).json()
    assert detail["status"] == "active" and detail["payment"]["paid_with"] == "Visa •••• 4081"
    activity = client.get(f"{API}/me/activity", headers=buyer).json()["items"]
    assert any(i["kind"] == "purchase" and i["detail"] == "Visa •••• 4081" for i in activity)


def test_signed_webhook_confirms_and_only_once(paystack):
    buyer = _login("0788800002", "card2@example.com")
    event = _event(buyer, "Webhook Gig")
    pid = _buy_by_card(buyer, event["id"]).json()["payment_id"]
    paystack.pay(pid)
    event_body = {"event": "charge.success", "data": {"reference": pid, "status": "success"}}

    forged, headers = _signed(event_body, secret="sk_test_wrong")
    assert client.post(f"{API}/payments/paystack/webhook", content=forged, headers=headers).status_code == 400
    assert client.post(f"{API}/payments/paystack/webhook", json=event_body).status_code == 400
    assert _sold(event["id"]) == 0

    body, headers = _signed(event_body)
    assert client.post(f"{API}/payments/paystack/webhook", content=body, headers=headers).status_code == 200
    assert client.post(f"{API}/payments/paystack/webhook", content=body, headers=headers).status_code == 200  # retried
    assert client.get(f"{API}/payments/{pid}/status", headers=buyer).json()["status"] == "success"
    assert _sold(event["id"]) == 1 and len(paystack.minted) == 1


def test_a_short_payment_is_not_accepted(paystack):
    buyer = _login("0788800008", "card8@example.com")
    event = _event(buyer, "Short Pay")
    pid = _buy_by_card(buyer, event["id"]).json()["payment_id"]
    paystack.pay(pid, amount=100)  # KES 1 instead of KES 750
    assert client.get(f"{API}/payments/{pid}/status", headers=buyer).json()["status"] == "initiated"
    assert _sold(event["id"]) == 0


def test_cancelling_on_paystack_cancels_the_tickets(paystack):
    buyer = _login("0788800003", "card3@example.com")
    event = _event(buyer, "Changed Mind")
    body = _buy_by_card(buyer, event["id"]).json()
    res = client.post(f"{API}/payments/{body['payment_id']}/cancel", headers=buyer)
    assert res.status_code == 200 and res.json()["status"] == "failed"
    assert res.json()["failure_reason"] == "You cancelled the card payment."
    db = TestingSessionLocal()
    assert db.get(Ticket, body["ticket_id"]).status == TicketStatus.CANCELLED
    db.close()
    assert _sold(event["id"]) == 0


def test_paying_in_another_tab_beats_cancel(paystack):
    buyer = _login("0788800004", "card4@example.com")
    event = _event(buyer, "Two Tabs")
    pid = _buy_by_card(buyer, event["id"]).json()["payment_id"]
    paystack.pay(pid)
    assert client.post(f"{API}/payments/{pid}/cancel", headers=buyer).json()["status"] == "success"


def test_card_rules(paystack, monkeypatch):
    no_email = _login("0788800005")
    event = _event(no_email, "Rules Gig")
    res = _buy_by_card(no_email, event["id"])
    assert res.status_code == 400 and "email" in res.json()["detail"]

    buyer = _login("0788800009", "card9@example.com")
    pid = _buy_by_card(buyer, event["id"]).json()["payment_id"]
    assert client.post(f"{API}/payments/{pid}/dev-confirm", headers=buyer).status_code == 400

    # M-Pesa still needs a number; a card doesn't.
    res = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "method": "mpesa"}, headers=buyer)
    assert res.status_code == 422

    from app.api.routes import payments
    monkeypatch.setattr(payments.settings, "PAYSTACK_SECRET_KEY", "")
    res = _buy_by_card(buyer, event["id"])
    assert res.status_code == 400 and "aren't available" in res.json()["detail"]
    assert "card_payments" in client.get("/").json()


def test_card_payment_is_recorded_as_card(paystack):
    buyer = _login("0788800006", "card6@example.com")
    event = _event(buyer, "Record Gig")
    pid = _buy_by_card(buyer, event["id"]).json()["payment_id"]
    db = TestingSessionLocal()
    p = db.get(Payment, pid)
    assert p.method == "card" and p.provider_reference == pid and p.phone_number == "254788800006"
    db.close()


def test_registering_an_organisation():
    me = _login("0788800007", "amani@example.com")
    client.patch(f"{API}/me/profile", json={"display_name": "Amani Otieno"}, headers=me)

    bad = client.post(f"{API}/organisations/", json={"business_name": "Amani Live", "kra_pin": "12345"}, headers=me)
    assert bad.status_code == 422
    assert client.post(f"{API}/organisations/", json={"business_name": " x "}, headers=me).status_code == 422

    res = client.post(f"{API}/organisations/", json={"business_name": "  Amani   Live ", "kra_pin": "p051234567x"}, headers=me)
    assert res.status_code == 201, res.text
    org = res.json()
    assert org["business_name"] == "Amani Live" and org["verification_status"] == "pending"

    p = client.get(f"{API}/organisations/{org['id']}/profile", headers=me).json()
    # Contact details default to the account's own.
    assert p["kraPin"] == "P051234567X" and p["contactEmail"] == "amani@example.com" and p["contactPhone"] == "254788800007"
    assert any(o["id"] == org["id"] and o["role"] == "owner" for o in client.get(f"{API}/organisations/mine", headers=me).json())
