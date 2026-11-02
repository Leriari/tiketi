"""
The M-Pesa STK callback (app/api/routes/payments.py): Daraja's callbacks
aren't signed, so a payment is only marked paid through its own secret URL,
for its own checkout and amount, and not when Daraja, asked directly, says
it wasn't paid.
"""
import uuid

import pytest

from app.models.models import Payment, PaymentStatus
from app.services import mpesa as mpesa_svc
from tests.test_api import TestingSessionLocal, client

API = "/api/v1"


def _login(phone: str) -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


class FakeDaraja:
    def __init__(self):
        self.pushes = []
        self.paid = True  # what the STK query answers
        self.query_fails = False

    async def stk_push(self, **kwargs):
        self.pushes.append(kwargs)
        return {"MerchantRequestID": "m", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    async def query_stk_status(self, checkout_request_id):
        if self.query_fails:
            raise RuntimeError("Daraja is down")
        return {"ResponseCode": "0", "ResultCode": "0" if self.paid else "1032",
                "ResultDesc": "processed successfully" if self.paid else "Request cancelled by user"}


@pytest.fixture
def daraja(monkeypatch):
    from app.worker import mint_ticket_nft
    fake = FakeDaraja()
    monkeypatch.setattr(mpesa_svc, "stk_push", fake.stk_push)
    monkeypatch.setattr(mpesa_svc, "query_stk_status", fake.query_stk_status)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)
    return fake


@pytest.fixture(scope="module")
def buyer():
    return _login("0769900001")


@pytest.fixture(scope="module")
def event():
    owner = _login("0769900002")
    org = client.post(f"{API}/organisations/", json={"business_name": "Callback Check Events"}, headers=owner).json()
    res = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Callback Night", "venue": "KICC", "event_date": "2027-05-01T18:00",
        "ticket_price_kes": 700, "total_capacity": 50,
    }, headers=owner)
    assert res.status_code == 201, res.text
    return res.json()


def _purchase(buyer, event) -> dict:
    res = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0769900001", "quantity": 1}, headers=buyer)
    assert res.status_code == 201, res.text
    return res.json()


def _paid(checkout_id: str, amount: float = 700, code: int = 0) -> dict:
    callback = {"MerchantRequestID": "m", "CheckoutRequestID": checkout_id, "ResultCode": code, "ResultDesc": "OK"}
    if code == 0:
        callback["CallbackMetadata"] = {"Item": [{"Name": "Amount", "Value": amount}, {"Name": "MpesaReceiptNumber", "Value": "SKB1CALLBK"}]}
    return {"Body": {"stkCallback": callback}}


def _status(payment_id: str) -> PaymentStatus:
    db = TestingSessionLocal()
    try:
        return db.get(Payment, payment_id).status
    finally:
        db.close()


def test_each_push_gets_its_own_callback_url(daraja, buyer, event):
    purchase = _purchase(buyer, event)
    url = daraja.pushes[-1]["callback_url"]
    assert url.endswith(mpesa_svc.stk_callback_path(purchase["payment_id"]))
    assert purchase["payment_id"] in url


def test_genuine_callback_marks_the_payment_paid(daraja, buyer, event):
    purchase = _purchase(buyer, event)
    res = client.post(mpesa_svc.stk_callback_path(purchase["payment_id"]), json=_paid(purchase["checkout_request_id"]))
    assert res.json()["ResultCode"] == 0
    assert _status(purchase["payment_id"]) == PaymentStatus.SUCCESS


def test_forged_callbacks_change_nothing(daraja, buyer, event):
    purchase = _purchase(buyer, event)
    pid, checkout = purchase["payment_id"], purchase["checkout_request_id"]

    # The old shared URL, and a guessed token.
    assert client.post(f"{API}/payments/mpesa/callback", json=_paid(checkout)).status_code == 200
    assert client.post(f"{API}/payments/mpesa/callback/{pid}/{'0' * 32}", json=_paid(checkout)).status_code == 403
    # The right URL, but another checkout, or less money than the price.
    path = mpesa_svc.stk_callback_path(pid)
    client.post(path, json=_paid("c-someone-else"))
    client.post(path, json=_paid(checkout, amount=1))
    assert _status(pid) == PaymentStatus.INITIATED

    # Daraja, asked directly, says it wasn't paid.
    daraja.paid = False
    client.post(path, json=_paid(checkout))
    assert _status(pid) == PaymentStatus.INITIATED


def test_callback_still_applies_when_daraja_cannot_be_asked(daraja, buyer, event):
    daraja.query_fails = True
    purchase = _purchase(buyer, event)
    client.post(mpesa_svc.stk_callback_path(purchase["payment_id"]), json=_paid(purchase["checkout_request_id"]))
    assert _status(purchase["payment_id"]) == PaymentStatus.SUCCESS


def test_failed_payment_callback_cancels_it(daraja, buyer, event):
    purchase = _purchase(buyer, event)
    client.post(mpesa_svc.stk_callback_path(purchase["payment_id"]), json=_paid(purchase["checkout_request_id"], code=1032))
    assert _status(purchase["payment_id"]) == PaymentStatus.FAILED
