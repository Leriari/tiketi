"""
Integration tests for the full API flow:
  Auth → Create Event → Purchase Ticket → Callback → Get Seed → Scan
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.session import Base, get_db

# ── In-memory SQLite for tests (fresh DB each run, no persistence) ─────────────
TEST_DB_URL = "sqlite://"   # pure in-memory; destroyed when engine is disposed
from sqlalchemy.pool import StaticPool

test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,  # keeps one connection alive so in-memory DB persists
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

Base.metadata.create_all(bind=test_engine)

client = TestClient(app)


@pytest.fixture(autouse=True, scope="module")
def reset_db():
    """Drop and recreate all tables once before the test module runs."""
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    yield


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def auth_token():
    """Authenticate a test user and return JWT."""
    phone = "0712345678"

    # Request OTP
    res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
    assert res.status_code == 200
    otp = res.json()["dev_otp"]  # Only available in development mode

    # Verify OTP
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="module")
def test_event(auth_headers):
    """Create a test event."""
    payload = {
        "title": "Nairobi Tech Meetup",
        "venue": "iHub, Westlands",
        "event_date": "2025-12-01T18:00:00",
        "organizer_phone": "0722000000",
        "ticket_price_kes": 500,
        "total_capacity": 100,
    }
    res = client.post("/api/v1/events/", json=payload, headers=auth_headers)
    assert res.status_code == 201
    return res.json()


# ── Auth Tests ─────────────────────────────────────────────────────────────────

def test_health():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_request_otp_invalid_phone():
    res = client.post("/api/v1/auth/request-otp", json={"phone_number": "notaphone"})
    assert res.status_code == 422


def test_verify_otp_wrong_code():
    client.post("/api/v1/auth/request-otp", json={"phone_number": "0799000001"})
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": "0799000001", "otp_code": "000000"})
    assert res.status_code == 401


def test_get_me_unauthenticated():
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 403


def test_get_me_authenticated(auth_headers):
    res = client.get("/api/v1/auth/me", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["phone_number"] == "254712345678"


# ── Event Tests ────────────────────────────────────────────────────────────────

def test_list_events_empty():
    res = client.get("/api/v1/events/")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_create_event(test_event):
    assert test_event["title"] == "Nairobi Tech Meetup"
    assert test_event["ticket_price_kes"] == 500
    assert test_event["tickets_remaining"] == 100
    assert test_event["max_resale_price_kes"] == 600.0  # 1.2x


def test_get_event_by_id(test_event):
    res = client.get(f"/api/v1/events/{test_event['id']}")
    assert res.status_code == 200
    assert res.json()["id"] == test_event["id"]


def test_get_event_not_found():
    res = client.get("/api/v1/events/nonexistent-id")
    assert res.status_code == 404


# ── Ticket Tests (without real M-Pesa) ────────────────────────────────────────

def test_get_my_tickets_empty(auth_headers):
    res = client.get("/api/v1/tickets/my", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == []


def test_purchase_requires_auth(test_event):
    res = client.post("/api/v1/payments/purchase", json={
        "event_id": test_event["id"],
        "phone_number": "0712345678",
    })
    assert res.status_code == 403


def test_purchase_invalid_event(auth_headers):
    res = client.post("/api/v1/payments/purchase", json={
        "event_id": "fake-event-id",
        "phone_number": "0712345678",
    }, headers=auth_headers)
    assert res.status_code == 404


# ── Simulate Full M-Pesa Flow ──────────────────────────────────────────────────

def test_full_mpesa_flow(auth_headers, test_event, monkeypatch):
    """
    Simulate the full purchase flow by mocking the M-Pesa STK push
    and manually firing the callback.
    """
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft

    # Mock STK push — return a fake Daraja response with a unique ID
    import uuid
    mock_checkout_id = f"test-checkout-{uuid.uuid4().hex[:8]}"

    async def mock_stk_push(**kwargs):
        return {
            "MerchantRequestID": f"test-merchant-{uuid.uuid4().hex[:8]}",
            "CheckoutRequestID": mock_checkout_id,
            "ResponseCode": "0",
        }

    monkeypatch.setattr(mpesa_svc, "stk_push", mock_stk_push)
    # Don't let this test enqueue a real Celery task onto the real Redis
    # broker — it's a side effect on an external system the test shouldn't have.
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)

    # 1. Initiate purchase
    res = client.post("/api/v1/payments/purchase", json={
        "event_id": test_event["id"],
        "phone_number": "0712345678",
    }, headers=auth_headers)

    assert res.status_code == 201
    data = res.json()
    ticket_id = data["ticket_id"]
    payment_id = data["payment_id"]
    assert data["checkout_request_id"] == mock_checkout_id

    # 2. Check status is INITIATED
    res = client.get(f"/api/v1/payments/{payment_id}/status", headers=auth_headers)
    assert res.json()["status"] == "initiated"

    # 3. Simulate M-Pesa success callback
    callback_payload = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "test-merchant-req-1",
                "CheckoutRequestID": mock_checkout_id,
                "ResultCode": 0,
                "ResultDesc": "The service request is processed successfully.",
                "CallbackMetadata": {
                    "Item": [
                        {"Name": "Amount", "Value": 500.0},
                        {"Name": "MpesaReceiptNumber", "Value": "OEI2AK4MFU"},
                        {"Name": "TransactionDate", "Value": 20241201180000},
                        {"Name": "PhoneNumber", "Value": 254712345678},
                    ]
                }
            }
        }
    }
    res = client.post("/api/v1/payments/mpesa/callback", json=callback_payload)
    assert res.status_code == 200

    # 4. Check status is now SUCCESS
    res = client.get(f"/api/v1/payments/{payment_id}/status", headers=auth_headers)
    assert res.json()["status"] == "success"
    assert res.json()["mpesa_receipt_number"] == "OEI2AK4MFU"

    # 5. Check ticket is ACTIVE
    res = client.get("/api/v1/tickets/my", headers=auth_headers)
    tickets = res.json()
    assert len(tickets) == 1
    assert tickets[0]["status"] == "active"
    assert tickets[0]["id"] == ticket_id

    # 6. Get TOTP seed
    res = client.get(f"/api/v1/tickets/{ticket_id}/seed", headers=auth_headers)
    assert res.status_code == 200
    seed_data = res.json()
    assert len(seed_data["totp_secret"]) == 32
    assert seed_data["event_title"] == "Nairobi Tech Meetup"

    # 7. Get QR code image
    res = client.get(f"/api/v1/tickets/{ticket_id}/qr.png", headers=auth_headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content[:4] == b"\x89PNG"

    # 8. Simulate gate scan using the TOTP secret
    from app.services.totp_service import build_qr_payload
    qr_payload = build_qr_payload(ticket_id, seed_data["totp_secret"])

    res = client.post("/api/v1/gate/scan", json={
        "qr_payload": qr_payload,
        "scanner_id": "bouncer-device-001",
    })
    assert res.status_code == 200
    scan = res.json()
    assert scan["valid"] is True
    assert scan["ticket_id"] == ticket_id

    # 9. Try scanning the same ticket again — should be rejected
    qr_payload_2 = build_qr_payload(ticket_id, seed_data["totp_secret"])
    res = client.post("/api/v1/gate/scan", json={
        "qr_payload": qr_payload_2,
        "scanner_id": "bouncer-device-002",
    })
    scan2 = res.json()
    assert scan2["valid"] is False
    assert "Already used" in scan2["reason"]


# ── Multi-ticket / repeat purchase ──────────────────────────────────────────────

def test_purchase_quantity_creates_one_payment_and_n_tickets(test_event, monkeypatch):
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft
    import uuid

    phone = "0700222333"
    login_res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    checkout_id = f"test-checkout-{uuid.uuid4().hex[:8]}"

    async def mock_stk_push(**kwargs):
        return {
            "MerchantRequestID": f"test-merchant-{uuid.uuid4().hex[:8]}",
            "CheckoutRequestID": checkout_id,
            "ResponseCode": "0",
        }

    monkeypatch.setattr(mpesa_svc, "stk_push", mock_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)

    res = client.post("/api/v1/payments/purchase", json={
        "event_id": test_event["id"],
        "phone_number": phone,
        "quantity": 3,
    }, headers=headers)
    assert res.status_code == 201, res.text
    data = res.json()
    assert len(data["ticket_ids"]) == 3
    assert data["ticket_id"] == data["ticket_ids"][0]
    payment_id = data["payment_id"]

    res = client.get(f"/api/v1/payments/{payment_id}/status", headers=headers)
    assert res.json()["amount_kes"] == test_event["ticket_price_kes"] * 3

    res = client.post(f"/api/v1/payments/{payment_id}/dev-confirm", headers=headers)
    assert res.status_code == 200

    res = client.get("/api/v1/tickets/my", headers=headers)
    tickets = res.json()
    assert len(tickets) == 3
    assert all(t["status"] == "active" for t in tickets)
    assert {t["id"] for t in tickets} == set(data["ticket_ids"])


def test_purchase_quantity_rejects_more_than_remaining_capacity(auth_headers):
    res = client.post("/api/v1/events/", json={
        "title": "Tiny Capacity Event",
        "venue": "Test Venue",
        "event_date": "2027-01-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 100,
        "total_capacity": 2,
    }, headers=auth_headers)
    event = res.json()

    res = client.post("/api/v1/payments/purchase", json={
        "event_id": event["id"],
        "phone_number": "0700333444",
        "quantity": 3,
    }, headers=auth_headers)
    assert res.status_code == 400


def test_can_purchase_same_event_more_than_once(auth_headers, test_event, monkeypatch):
    """
    test_full_mpesa_flow already bought this user one ticket for test_event —
    the old code blocked a second purchase for the same event entirely.
    """
    from app.services import mpesa as mpesa_svc
    from app.worker import mint_ticket_nft
    import uuid

    checkout_id = f"test-checkout-{uuid.uuid4().hex[:8]}"

    async def mock_stk_push(**kwargs):
        return {
            "MerchantRequestID": f"test-merchant-{uuid.uuid4().hex[:8]}",
            "CheckoutRequestID": checkout_id,
            "ResponseCode": "0",
        }

    monkeypatch.setattr(mpesa_svc, "stk_push", mock_stk_push)
    monkeypatch.setattr(mint_ticket_nft, "delay", lambda *a, **kw: None)

    res = client.get("/api/v1/tickets/my", headers=auth_headers)
    before_count = len(res.json())
    assert before_count >= 1  # from test_full_mpesa_flow

    res = client.post("/api/v1/payments/purchase", json={
        "event_id": test_event["id"],
        "phone_number": "0712345678",
    }, headers=auth_headers)
    assert res.status_code == 201, res.text
    payment_id = res.json()["payment_id"]

    res = client.post(f"/api/v1/payments/{payment_id}/dev-confirm", headers=auth_headers)
    assert res.status_code == 200

    res = client.get("/api/v1/tickets/my", headers=auth_headers)
    assert len(res.json()) == before_count + 1


# ── Gate Sync Auth Tests ───────────────────────────────────────────────────────

def test_sync_event_requires_auth(test_event):
    res = client.get(f"/api/v1/gate/sync-event/{test_event['id']}")
    assert res.status_code == 403


def test_sync_event_forbidden_for_unrelated_user(test_event):
    """An authenticated user with no organizer-member or gate-scanner link to
    this event must not be able to pull ticket secrets for it."""
    phone = "0733000099"
    res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
    otp = res.json()["dev_otp"]
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    token = res.json()["access_token"]

    res = client.get(
        f"/api/v1/gate/sync-event/{test_event['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_sync_event_allowed_for_registered_scanner(test_event):
    """A user linked to a GateScanner device registered for this event can sync."""
    from app.models.models import GateScanner

    phone = "0733000098"
    res = client.post("/api/v1/auth/request-otp", json={"phone_number": phone})
    otp = res.json()["dev_otp"]
    res = client.post("/api/v1/auth/verify-otp", json={"phone_number": phone, "otp_code": otp})
    token = res.json()["access_token"]
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = res.json()["id"]

    db = TestingSessionLocal()
    db.add(GateScanner(
        event_id=test_event["id"],
        account_id=user_id,
        gate_name="Main Gate",
        device_id="test-device-001",
    ))
    db.commit()
    db.close()

    res = client.get(
        f"/api/v1/gate/sync-event/{test_event['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["event_id"] == test_event["id"]
    assert isinstance(data["tickets"], list)
