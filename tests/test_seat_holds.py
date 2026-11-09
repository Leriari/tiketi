"""
Seats being paid for are held (app/api/routes/payments.py _seats_held): two
buyers can't both pay for the last ticket. A hold ends when the payment
fails or its time runs out.
"""
from datetime import datetime, timedelta

from app.models.models import Event, Payment
from app.services.mpesa import stk_callback_path
from tests.test_api import TestingSessionLocal, client
from tests.test_mpesa_callback import _login, _paid, daraja  # noqa: F401 (fixture)

API = "/api/v1"


def _event(capacity: int) -> dict:
    owner = _login("0769910001")
    org = client.post(f"{API}/organisations/", json={"business_name": "Seat Hold Events"}, headers=owner).json()
    res = client.post(f"{API}/events/", json={
        "organization_id": org["id"], "title": "Last Seat Night", "venue": "KICC", "event_date": "2027-05-01T18:00",
        "ticket_price_kes": 700, "total_capacity": capacity,
    }, headers=owner)
    assert res.status_code == 201, res.text
    return res.json()


def _buy(headers, event, quantity=1):
    return client.post(f"{API}/payments/purchase",
                       json={"event_id": event["id"], "phone_number": "0769910002", "quantity": quantity}, headers=headers)


def test_last_seat_is_held_while_someone_pays(daraja):
    event = _event(1)
    first, second = _login("0769910002"), _login("0769910003")
    pending = _buy(first, event)
    assert pending.status_code == 201, pending.text

    blocked = _buy(second, event)
    assert blocked.status_code == 409
    assert "being bought" in blocked.json()["detail"]

    # The first buyer cancels the prompt: the seat is free again.
    res = client.post(stk_callback_path(pending.json()["payment_id"]), json=_paid(pending.json()["checkout_request_id"], code=1032))
    assert res.status_code == 200
    assert _buy(second, event).status_code == 201


def test_hold_counts_every_ticket_in_the_purchase(daraja):
    event = _event(3)
    assert _buy(_login("0769910004"), event, quantity=2).status_code == 201
    assert _buy(_login("0769910005"), event, quantity=2).status_code == 409
    assert _buy(_login("0769910005"), event, quantity=1).status_code == 201


def test_hold_lapses_after_the_prompt_expires(daraja):
    event = _event(1)
    pending = _buy(_login("0769910006"), event)
    assert pending.status_code == 201

    db = TestingSessionLocal()
    payment = db.get(Payment, pending.json()["payment_id"])
    payment.initiated_at = datetime.utcnow() - timedelta(minutes=6)
    db.commit()
    db.close()
    assert _buy(_login("0769910007"), event).status_code == 201


def test_a_late_payment_still_gets_its_ticket(daraja):
    """A buyer who paid after their hold lapsed has still paid."""
    event = _event(1)
    late = _buy(_login("0769910008"), event)
    db = TestingSessionLocal()
    db.get(Payment, late.json()["payment_id"]).initiated_at = datetime.utcnow() - timedelta(minutes=6)
    db.commit()
    db.close()

    res = client.post(stk_callback_path(late.json()["payment_id"]), json=_paid(late.json()["checkout_request_id"]))
    assert res.status_code == 200
    db = TestingSessionLocal()
    assert db.get(Event, event["id"]).tickets_sold == 1
    db.close()
