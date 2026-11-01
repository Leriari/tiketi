"""
Payouts (app/services/payouts.py) with Daraja faked: sellers withdrawing
their wallet by B2C, organisers requesting payouts that a finance admin
approves (B2C, or B2B to a paybill or till), and Safaricom's results posted
to each payout's own result URL — applied once, only with the right token
and IDs, and giving the money back when a payout fails.
"""
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlsplit

import pytest

from app.core.config import get_settings
from app.models.models import Event, Payout, User, WalletTransaction, WalletTransactionType
from app.services import mpesa as mpesa_svc
from tests.test_api import TestingSessionLocal, client

API = "/api/v1"


def _login(phone: str) -> dict:
    otp = client.post(f"{API}/auth/request-otp", json={"phone_number": phone}).json()["dev_otp"]
    res = client.post(f"{API}/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _msisdn(phone: str) -> str:
    return "254" + phone[1:]


def _make_admin(phone: str, role: str | None = None) -> dict:
    headers = _login(phone)
    db = TestingSessionLocal()
    user = db.query(User).filter(User.phone_number == _msisdn(phone)).one()
    user.is_platform_admin, user.platform_admin_role = True, role
    db.commit()
    db.close()
    return headers


def _seller(phone: str, earned_kes: float) -> dict:
    """A seller with earned_kes of resale proceeds already released."""
    headers = _login(phone)
    db = TestingSessionLocal()
    user = db.query(User).filter(User.phone_number == _msisdn(phone)).one()
    db.add(WalletTransaction(user_id=user.id, type=WalletTransactionType.SALE, description="Sold a ticket",
                             amount_kes=earned_kes, available_at=datetime.utcnow() - timedelta(days=1)))
    db.commit()
    db.close()
    return headers


def _wallet(headers: dict) -> dict:
    return client.get(f"{API}/resale/wallet", headers=headers).json()


class FakeDaraja:
    def __init__(self):
        self.b2c, self.b2b, self.status = [], [], []
        self.fail_with = None  # an exception the next request raises

    def _answer(self, calls, kw, originator=None):
        calls.append(kw)
        if self.fail_with:
            error, self.fail_with = self.fail_with, None
            raise error
        return {"OriginatorConversationID": originator or f"daraja-{uuid.uuid4().hex[:8]}",
                "ConversationID": f"AG_{uuid.uuid4().hex[:16]}", "ResponseCode": "0"}

    async def b2c_payment(self, **kw):
        return self._answer(self.b2c, kw, kw["originator_conversation_id"])

    async def b2b_payment(self, **kw):
        return self._answer(self.b2b, kw)

    async def transaction_status(self, **kw):
        return self._answer(self.status, kw)


@pytest.fixture
def daraja(monkeypatch):
    fake = FakeDaraja()
    monkeypatch.setattr(mpesa_svc, "b2c_payment", fake.b2c_payment)
    monkeypatch.setattr(mpesa_svc, "b2b_payment", fake.b2b_payment)
    monkeypatch.setattr(mpesa_svc, "transaction_status", fake.transaction_status)
    for settings in _all_settings():
        monkeypatch.setattr(settings, "MPESA_CONSUMER_KEY", settings.MPESA_CONSUMER_KEY or "test-key")
        monkeypatch.setattr(settings, "MPESA_PAYOUT_SHORTCODE", "600992")
        monkeypatch.setattr(settings, "MPESA_INITIATOR_NAME", "testapi")
        monkeypatch.setattr(settings, "MPESA_SECURITY_CREDENTIAL", "encrypted==")
    return fake


@pytest.fixture
def no_daraja(monkeypatch):
    for settings in _all_settings():
        monkeypatch.setattr(settings, "MPESA_SECURITY_CREDENTIAL", "")


def _all_settings():
    """Every Settings object the payout code reads: modules keep the one
    they imported, and other test modules sometimes replace the cached one."""
    from app.api.routes import admin
    from app.services import payouts
    return {id(s): s for s in (get_settings(), payouts.settings, admin.settings, mpesa_svc.settings)}.values()


@pytest.fixture(autouse=True)
def stub_external(monkeypatch):
    from app.worker import mint_ticket_nft

    async def fake_stk_push(**kwargs):
        return {"MerchantRequestID": "m", "CheckoutRequestID": f"c-{uuid.uuid4().hex[:10]}", "ResponseCode": "0"}

    monkeypatch.setattr(mpesa_svc, "stk_push", fake_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)


def _post_result(url: str, body: dict):
    return client.post(urlsplit(url).path, json=body)


def _b2c_result(call: dict, conversation_id: str, code: int = 0, amount: float | None = None) -> dict:
    result = {"ResultType": 0, "ResultCode": code, "ResultDesc": "The service request is processed successfully."
              if code == 0 else "The balance is insufficient for the transaction.",
              "OriginatorConversationID": call["originator_conversation_id"], "ConversationID": conversation_id,
              "TransactionID": "SG632NMUAB"}
    if code == 0:
        result["ResultParameters"] = {"ResultParameter": [
            {"Key": "TransactionAmount", "Value": call["amount"] if amount is None else amount},
            {"Key": "TransactionReceipt", "Value": "SG632NMUAB"},
            {"Key": "ReceiverPartyPublicName", "Value": "254768800001 - JANE SELLER"},
            {"Key": "B2CUtilityAccountAvailableFunds", "Value": 8959269.60},
        ]}
    return {"Result": result}


def _payout_row(payout_id: str) -> Payout:
    db = TestingSessionLocal()
    row = db.get(Payout, payout_id)
    db.close()
    return row


# ── Sellers ─────────────────────────────────────────────────────────────────

def test_seller_withdraws_any_amount_by_b2c(daraja):
    seller = _seller("0768800001", 2000)
    res = client.post(f"{API}/resale/withdraw", json={"amount_kes": 1000}, headers=seller)
    assert res.status_code == 200, res.text
    payout = res.json()
    assert payout["status"] == "processing"
    assert (payout["charge_kes"], payout["net_kes"]) == (5, 995)

    call = daraja.b2c[0]
    assert call["phone_number"] == "254768800001"  # always the seller's own number
    assert call["amount"] == 995
    assert call["originator_conversation_id"] == payout["id"]

    wallet = _wallet(seller)
    assert wallet["available"] == 1000  # held from the moment it was requested
    assert wallet["transactions"][0]["status"] == "pending"

    conversation = _payout_row(payout["id"]).conversation_id
    assert _post_result(call["result_url"], _b2c_result(call, conversation)).json()["ResultCode"] == 0
    wallet = _wallet(seller)
    row = wallet["transactions"][0]
    assert row["status"] == "success"
    assert row["payout"]["status"] == "paid"
    assert row["payout"]["mpesa_receipt"] == "SG632NMUAB"
    assert wallet["available"] == 1000

    # The same result again changes nothing.
    _post_result(call["result_url"], _b2c_result(call, conversation, code=1))
    assert _payout_row(payout["id"]).status.value == "paid"


def test_failed_b2c_result_returns_the_money(daraja):
    seller = _seller("0768800002", 600)
    payout = client.post(f"{API}/resale/withdraw", json={"amount_kes": 600}, headers=seller).json()
    assert _wallet(seller)["available"] == 0
    call = daraja.b2c[0]
    _post_result(call["result_url"], _b2c_result(call, _payout_row(payout["id"]).conversation_id, code=1))

    wallet = _wallet(seller)
    assert wallet["available"] == 600
    assert wallet["transactions"][0]["status"] == "failed"
    assert "insufficient" in wallet["transactions"][0]["payout"]["note"]


def test_results_need_the_token_and_matching_ids(daraja):
    seller = _seller("0768800003", 500)
    payout = client.post(f"{API}/resale/withdraw", json={"amount_kes": 500}, headers=seller).json()
    call = daraja.b2c[0]
    conversation = _payout_row(payout["id"]).conversation_id

    forged = call["result_url"].rsplit("/", 1)[0] + "/" + "0" * 32
    assert _post_result(forged, _b2c_result(call, conversation)).status_code == 403
    # Right URL, but about another request: ignored.
    _post_result(call["result_url"], _b2c_result(call, "AG_someone_else"))
    # Right IDs, wrong amount: left for an admin.
    _post_result(call["result_url"], _b2c_result(call, conversation, amount=100000))
    row = _payout_row(payout["id"])
    assert row.status.value == "processing"
    assert "Needs checking" in row.result_desc


def test_withdrawal_limits(daraja):
    seller = _seller("0768800004", 300)
    for amount, message in ((301, "available balance"), (50, "minimum"), (150.5, "whole number")):
        res = client.post(f"{API}/resale/withdraw", json={"amount_kes": amount}, headers=seller)
        assert res.status_code == 400 and message in res.json()["detail"], res.text
    assert not daraja.b2c

    # Daraja refusing the request: nothing was sent, so the money is back at once.
    daraja.fail_with = mpesa_svc.PayoutRequestError("Bad Request - Invalid PartyB")
    res = client.post(f"{API}/resale/withdraw", json={"amount_kes": 300}, headers=seller)
    assert res.json()["status"] == "failed"
    assert "Invalid PartyB" in res.json()["note"]
    assert _wallet(seller)["available"] == 300


def test_no_clear_answer_is_settled_by_a_status_check(daraja):
    admin = _make_admin("0768800090", "finance")
    seller = _seller("0768800005", 1000)
    daraja.fail_with = mpesa_svc.PayoutRequestUncertain("ReadTimeout talking to Daraja")
    payout = client.post(f"{API}/resale/withdraw", json={"amount_kes": 1000}, headers=seller).json()
    assert payout["status"] == "processing"  # never assumed failed
    assert "Check its status" in payout["note"]
    assert _wallet(seller)["available"] == 0

    res = client.post(f"{API}/admin/payout-requests/{payout['id']}/check-status", headers=admin)
    assert res.status_code == 200, res.text
    check = daraja.status[0]
    assert check["originator_conversation_id"] == payout["id"]

    answer = {"Result": {"ResultCode": 0, "ResultDesc": "The service request is processed successfully.",
                         "OriginatorConversationID": "query-1", "ConversationID": "AG_query",
                         "ResultParameters": {"ResultParameter": [
                             {"Key": "OriginatorConversationID", "Value": payout["id"]},
                             {"Key": "TransactionStatus", "Value": "Completed"},
                             {"Key": "Amount", "Value": "995"},
                             {"Key": "ReceiptNo", "Value": "MBN31H462N"}]}}}
    _post_result(check["result_url"], answer)
    row = _payout_row(payout["id"])
    assert row.status.value == "paid" and row.mpesa_receipt == "MBN31H462N"


def test_without_daraja_an_admin_pays_by_hand(no_daraja):
    admin = _make_admin("0768800091", "finance")
    seller = _seller("0768800006", 800)
    payout = client.post(f"{API}/resale/withdraw", json={"amount_kes": 800}, headers=seller).json()
    assert payout["status"] == "pending_approval"
    assert _wallet(seller)["instantWithdrawals"] is False

    queue = client.get(f"{API}/admin/payout-requests", headers=admin).json()
    assert any(r["id"] == payout["id"] and r["recipient"] == "0768 800 006" for r in queue["requests"])
    res = client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=admin)
    assert res.status_code == 400 and "by hand" in res.json()["detail"]
    assert client.post(f"{API}/admin/payout-requests/{payout['id']}/mark-paid", json={"receipt": "no"}, headers=admin).status_code == 422
    res = client.post(f"{API}/admin/payout-requests/{payout['id']}/mark-paid", json={"receipt": "sg632nmuab"}, headers=admin)
    assert res.json()["status"] == "paid" and res.json()["manual"] is True
    assert _wallet(seller)["transactions"][0]["status"] == "success"


# ── Organisers ──────────────────────────────────────────────────────────────

_reviewer = {}


def _earning_org(owner: dict, name: str) -> dict:
    """A verified organisation with one KES 1,000 ticket sold at an event
    that's over and released (net 940 after the 5% fee and KES 10 scanning)."""
    if not _reviewer:
        _reviewer.update(_make_admin("0768800098"))  # a super admin, to verify organisations
    org = client.post(f"{API}/organisations/", json={"business_name": name}, headers=owner).json()
    assert client.post(f"{API}/admin/organisers/{org['id']}/review", json={"decision": "verified"}, headers=_reviewer).status_code == 200
    event = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": f"{name} Night", "venue": "KICC", "event_date": "2027-05-01T18:00",
        "ticket_price_kes": 1000, "total_capacity": 50,
    }, headers=owner).json()
    buyer = _login("0768800099")
    pay = client.post(f"{API}/payments/purchase", json={"event_id": event["id"], "phone_number": "0768800099", "quantity": 1}, headers=buyer)
    assert client.post(f"{API}/payments/{pay.json()['payment_id']}/dev-confirm", headers=buyer).status_code == 200
    db = TestingSessionLocal()
    db.get(Event, event["id"]).event_date = datetime.utcnow() - timedelta(days=10)
    db.commit()
    db.close()
    return org


def test_organiser_payout_needs_verification_and_details(daraja):
    owner = _login("0768800010")
    org = client.post(f"{API}/organisations/", json={"business_name": "Unverified Payouts"}, headers=owner).json()
    res = client.post(f"{API}/organisations/{org['id']}/payouts", json={"amount_kes": 500}, headers=owner)
    assert res.status_code == 400 and "verified" in res.json()["detail"]

    org = _earning_org(owner, "Detail-less Payouts")
    base = f"{API}/organisations/{org['id']}"
    info = client.get(f"{base}/payouts", headers=owner).json()
    assert info["available"] == 940
    assert "Payout Details" in info["blockedReason"]


def test_organiser_payout_approved_and_paid_by_b2c(daraja):
    owner = _login("0768800011")
    finance = _make_admin("0768800093", "finance")
    support = _make_admin("0768800094", "support")
    org = _earning_org(owner, "B2C Payout Events")
    base = f"{API}/organisations/{org['id']}"
    client.patch(f"{base}/payout-details", json={"payoutMethod": "mpesa", "payoutDestination": "0768800011"}, headers=owner)

    res = client.post(f"{base}/payouts", json={"amount_kes": 941}, headers=owner)
    assert res.status_code == 400 and "available balance" in res.json()["detail"]
    payout = client.post(f"{base}/payouts", json={"amount_kes": 600}, headers=owner).json()
    assert payout["status"] == "pending_approval"
    assert not daraja.b2c  # nothing goes out before an admin approves
    earnings = client.get(f"{base}/earnings", headers=owner).json()["wallet"]
    assert (earnings["availableBalance"], earnings["payoutsInProgress"]) == (340, 600)

    assert client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=support).status_code == 403
    res = client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=finance)
    assert res.json()["status"] == "processing", res.text
    assert client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=finance).status_code == 400
    call = daraja.b2c[0]
    assert (call["phone_number"], call["amount"]) == ("254768800011", 595)

    _post_result(call["result_url"], _b2c_result(call, _payout_row(payout["id"]).conversation_id))
    earnings = client.get(f"{base}/earnings", headers=owner).json()["wallet"]
    assert (earnings["availableBalance"], earnings["payoutsInProgress"], earnings["totalPaidOut"]) == (340, 0, 600)
    queue = client.get(f"{API}/admin/payout-requests", headers=finance).json()
    assert queue["payoutAccountBalance"]["kes"] == 8959269.60


def test_paybill_and_till_payouts_go_by_b2b_and_rejection_returns_money(daraja):
    owner = _login("0768800012")
    finance = _make_admin("0768800095", "finance")
    org = _earning_org(owner, "B2B Payout Events")
    base = f"{API}/organisations/{org['id']}"

    client.patch(f"{base}/payout-details", json={"payoutMethod": "paybill", "payoutDestination": "247247",
                                                 "payoutAccount": "0123456789", "payoutLabel": "Equity Bank"}, headers=owner)
    payout = client.post(f"{base}/payouts", json={"amount_kes": 300}, headers=owner).json()
    assert payout["destination"] == "Equity Bank (paybill 247247) · account *******789"
    # Changing the details afterwards doesn't redirect a request already made.
    client.patch(f"{base}/payout-details", json={"payoutMethod": "till", "payoutDestination": "5123456"}, headers=owner)
    client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=finance)
    call = daraja.b2b[0]
    assert (call["till"], call["party_b"], call["account_reference"], call["amount"]) == (False, "247247", "0123456789", 295)

    till = client.post(f"{base}/payouts", json={"amount_kes": 200}, headers=owner).json()
    client.post(f"{API}/admin/payout-requests/{till['id']}/approve", headers=finance)
    assert (daraja.b2b[1]["till"], daraja.b2b[1]["party_b"]) == (True, "5123456")

    rejected = client.post(f"{base}/payouts", json={"amount_kes": 440}, headers=owner).json()
    assert client.get(f"{base}/payouts", headers=owner).json()["available"] == 0
    res = client.post(f"{API}/admin/payout-requests/{rejected['id']}/reject", json={"reason": "Bank details unverified"}, headers=finance)
    assert res.json()["status"] == "rejected"
    info = client.get(f"{base}/payouts", headers=owner).json()
    assert info["available"] == 440
    assert info["payouts"][0]["note"] == "Bank details unverified"


def test_suspended_organisation_cannot_be_paid(daraja):
    owner = _login("0768800013")
    finance = _make_admin("0768800096")
    org = _earning_org(owner, "Suspended Payout Events")
    base = f"{API}/organisations/{org['id']}"
    client.patch(f"{base}/payout-details", json={"payoutMethod": "mpesa", "payoutDestination": "0768800013"}, headers=owner)
    payout = client.post(f"{base}/payouts", json={"amount_kes": 500}, headers=owner).json()
    assert client.post(f"{API}/admin/organisers/{org['id']}/suspend", json={"reason": "Fraud check"}, headers=finance).status_code == 200
    res = client.post(f"{API}/admin/payout-requests/{payout['id']}/approve", headers=finance)
    assert res.status_code == 400 and "suspended" in res.json()["detail"]
    assert not daraja.b2c
