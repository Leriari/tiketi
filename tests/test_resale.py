"""
Resale marketplace tests (Work Order 02).

Runs against a real local Hardhat chain (see conftest.py) — the cap
enforcement tests specifically need a genuine on-chain revert, not a
Python-side mock, to mean anything as evidence.

Reuses test_api.py's TestClient/DB setup (same in-memory SQLite engine and
`app.dependency_overrides`) rather than defining a second one — two
separate engines both bound to the same FastAPI `app.dependency_overrides`
dict would silently fight over which one every test actually hits.
"""
import pytest

from tests.test_api import client, TestingSessionLocal
from app.worker import mint_ticket_nft, settle_resale_transfer
from app.models.models import Ticket, Transfer, Barcode, BarcodeStatus

# mint_ticket_nft / settle_resale_transfer open their own DB session via
# `from app.db.session import SessionLocal` — that's bound to the real
# dev.db by default, bypassing the FastAPI dependency override the API
# routes use. Point it at the same in-memory test engine so a ticket
# created through the API is actually visible to a directly-called task.
import app.db.session as _db_session
_db_session.SessionLocal = TestingSessionLocal


# ── Helpers ──────────────────────────────────────────────────────────────────

def _login(phone: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"phone_number": phone})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _create_event(headers: dict, **overrides) -> dict:
    """Creates a fresh throwaway organisation per call (Work Order 04 B3 —
    every event now belongs to one) rather than threading an org id through
    every one of this file's ~15 call sites, none of which care which
    organisation owns the event, only that the same `headers` user owns it."""
    org_res = client.post("/api/v1/organisations/", json={"business_name": "Resale Test Org"}, headers=headers)
    assert org_res.status_code == 201, org_res.text

    payload = {
        "organization_id": org_res.json()["id"],
        "title": "Resale Test Event",
        "venue": "Test Venue",
        "event_date": "2027-06-01T18:00:00",
        "organizer_phone": "0700000000",
        "ticket_price_kes": 1000,
        "total_capacity": 50,
        "max_resale_multiplier": 1.2,
        "resale_royalty_percent": 10.0,
    }
    payload.update(overrides)
    res = client.post("/api/v1/events/", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _purchase_and_mint(headers: dict, event_id: str, phone: str) -> str:
    """Buy a ticket, dev-confirm it, and mint it for real on the local
    chain — synchronously, by calling the Celery task function directly
    rather than .delay() (no worker runs during tests)."""
    res = client.post(
        "/api/v1/payments/purchase",
        json={"event_id": event_id, "phone_number": phone},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    ticket_id = res.json()["ticket_id"]
    payment_id = res.json()["payment_id"]

    res = client.post(f"/api/v1/payments/{payment_id}/dev-confirm", headers=headers)
    assert res.status_code == 200, res.text

    result = mint_ticket_nft(ticket_id)
    assert result["status"] == "minted", result
    return ticket_id


def _get_ticket(ticket_id: str) -> Ticket:
    db = TestingSessionLocal()
    try:
        return db.query(Ticket).filter(Ticket.id == ticket_id).first()
    finally:
        db.close()


def _get_transfer(transfer_id: str) -> Transfer:
    db = TestingSessionLocal()
    try:
        return db.query(Transfer).filter(Transfer.id == transfer_id).first()
    finally:
        db.close()


def _list_ticket(headers: dict, ticket_id: str, price_kes: float) -> dict:
    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": price_kes},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def _buy_and_settle(buyer_headers: dict, listing_id: str, buyer_phone: str) -> str:
    """Buy a listing, dev-confirm it, and settle it for real on the local
    chain — synchronously, same reasoning as _purchase_and_mint."""
    res = client.post(
        f"/api/v1/resale/listings/{listing_id}/buy",
        json={"phone_number": buyer_phone},
        headers=buyer_headers,
    )
    assert res.status_code == 201, res.text
    payment_id = res.json()["payment_id"]

    res = client.post(f"/api/v1/payments/{payment_id}/dev-confirm", headers=buyer_headers)
    assert res.status_code == 200, res.text

    result = settle_resale_transfer(listing_id)
    assert result["status"] == "completed", result
    return result["tx_hash"]


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def seller_headers():
    return _login("0711000001")


@pytest.fixture(scope="module")
def buyer_headers():
    return _login("0711000002")


# ── Cap enforcement through the full stack ──────────────────────────────────
# The headline claim: an over-cap resale listing fails because the chain
# refused it, not because Python pre-validated the price.

@pytest.mark.parametrize("multiplier", [1.05, 1.10, 1.50])
def test_listing_at_exactly_the_cap_succeeds(seller_headers, multiplier):
    event = _create_event(seller_headers, max_resale_multiplier=multiplier, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")

    cap_price = round(1000 * multiplier)
    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": cap_price},
        headers=seller_headers,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "active"
    assert body["price"] == cap_price


@pytest.mark.parametrize("multiplier", [1.05, 1.10, 1.50])
def test_listing_one_shilling_above_cap_reverts_onchain(seller_headers, multiplier):
    event = _create_event(seller_headers, max_resale_multiplier=multiplier, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")

    cap_price = round(1000 * multiplier)
    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": cap_price + 1},
        headers=seller_headers,
    )
    assert res.status_code == 400, res.text
    detail = res.json()["detail"]
    # This IS the assertion that matters: the failure must be the contract's
    # own revert string, not an application-level validation message.
    assert detail == "TiketiNFT: price exceeds resale cap", detail


# ── Payout arithmetic ────────────────────────────────────────────────────────

def test_payout_arithmetic_exact_no_rounding_loss(seller_headers, buyer_headers):
    # Deliberately a price/royalty combination that doesn't divide cleanly.
    event = _create_event(seller_headers, ticket_price_kes=999, resale_royalty_percent=7.5)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 999)

    _buy_and_settle(buyer_headers, listing["id"], "0711000002")

    transfer = _get_transfer(listing["id"])
    assert transfer.transfer_price_kes == 999
    total = transfer.organizer_royalty_kes + transfer.platform_fee_kes + transfer.seller_payout_kes
    assert total == transfer.transfer_price_kes, (
        f"royalty({transfer.organizer_royalty_kes}) + fee({transfer.platform_fee_kes}) "
        f"+ payout({transfer.seller_payout_kes}) = {total}, expected {transfer.transfer_price_kes}"
    )


@pytest.mark.parametrize("price,royalty_percent", [(1499, 12.5), (777, 3.33), (10001, 15.0)])
def test_payout_arithmetic_various_odd_prices(seller_headers, buyer_headers, price, royalty_percent):
    event = _create_event(
        seller_headers, ticket_price_kes=price, resale_royalty_percent=royalty_percent, max_resale_multiplier=1.0
    )
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, price)

    _buy_and_settle(buyer_headers, listing["id"], "0711000002")

    transfer = _get_transfer(listing["id"])
    total = transfer.organizer_royalty_kes + transfer.platform_fee_kes + transfer.seller_payout_kes
    assert total == transfer.transfer_price_kes


# ── Credential rotation + ownership consistency ─────────────────────────────

def test_credential_rotates_and_ownership_updates_on_settlement(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")

    db = TestingSessionLocal()
    try:
        old_barcode = db.query(Ticket).filter(Ticket.id == ticket_id).first().current_barcode
        old_token = old_barcode.token
        old_barcode_id = old_barcode.id
    finally:
        db.close()

    listing = _list_ticket(seller_headers, ticket_id, 1000)
    tx_hash = _buy_and_settle(buyer_headers, listing["id"], "0711000002")
    assert tx_hash  # a real settlement tx hash was produced

    ticket = _get_ticket(ticket_id)
    db = TestingSessionLocal()
    try:
        db.add(ticket)
        old_barcode_reloaded = db.query(Barcode).filter(Barcode.id == old_barcode_id).first()
        new_barcode = ticket.current_barcode

        # The exact fraud this system exists to prevent: the seller's old
        # QR credential must stop working once the ticket is resold.
        assert old_barcode_reloaded.status == BarcodeStatus.REVOKED
        assert new_barcode.status == BarcodeStatus.ACTIVE
        assert new_barcode.token != old_token
        assert new_barcode.owner_id == ticket.owner_id

        # Ownership consistency, for THIS project's custodial architecture:
        # the on-chain owner never changes for an unclaimed custodial ticket
        # (it stays the minter throughout — see web3_service.py's module
        # docstring), so "on-chain owner == Ticket.owner_id" would be the
        # wrong invariant to check here. What must hold is that the
        # off-chain owner_id correctly reflects the buyer, and the on-chain
        # owner is unaffected by the sale (still the minter).
        buyer_user_id = ticket.owner_id
    finally:
        db.close()

    import app.services.web3_service as web3_service
    from eth_account import Account
    from app.core.config import get_settings

    settings = get_settings()
    minter_address = Account.from_key(settings.MINTER_PRIVATE_KEY).address
    contract = web3_service._get_contract()
    onchain_owner = contract.functions.ownerOf(ticket.nft_token_id).call()
    assert onchain_owner == minter_address
    assert buyer_user_id is not None


# ── Authorisation ────────────────────────────────────────────────────────────

def test_seller_can_only_list_their_own_ticket(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")

    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": 1000},
        headers=buyer_headers,
    )
    assert res.status_code == 404


def test_used_ticket_cannot_be_listed(seller_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")

    db = TestingSessionLocal()
    try:
        from app.models.models import TicketStatus
        ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        ticket.status = TicketStatus.USED
        db.commit()
    finally:
        db.close()

    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": 1000},
        headers=seller_headers,
    )
    assert res.status_code == 400
    assert "already been used" in res.json()["detail"]


def test_already_listed_ticket_cannot_be_listed_twice(seller_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    _list_ticket(seller_headers, ticket_id, 1000)

    res = client.post(
        "/api/v1/resale/listings",
        json={"ticket_id": ticket_id, "price_kes": 1000},
        headers=seller_headers,
    )
    assert res.status_code == 400
    assert "already listed" in res.json()["detail"]


def test_seller_cannot_buy_their_own_listing(seller_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 1000)

    res = client.post(
        f"/api/v1/resale/listings/{listing['id']}/buy",
        json={"phone_number": "0711000001"},
        headers=seller_headers,
    )
    assert res.status_code == 400


def test_only_seller_can_cancel_their_listing(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 1000)

    res = client.delete(f"/api/v1/resale/listings/{listing['id']}", headers=buyer_headers)
    assert res.status_code == 403


# ── Failure handling (Work Order 02 §4) ─────────────────────────────────────

def test_second_buyer_rejected_while_first_payment_in_flight(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 1000)

    res = client.post(
        f"/api/v1/resale/listings/{listing['id']}/buy",
        json={"phone_number": "0711000002"},
        headers=buyer_headers,
    )
    assert res.status_code == 201, res.text

    third_party_headers = _login("0711000003")
    res = client.post(
        f"/api/v1/resale/listings/{listing['id']}/buy",
        json={"phone_number": "0711000003"},
        headers=third_party_headers,
    )
    assert res.status_code == 409


def test_cancellation_loses_to_an_inflight_payment(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 1000)

    res = client.post(
        f"/api/v1/resale/listings/{listing['id']}/buy",
        json={"phone_number": "0711000002"},
        headers=buyer_headers,
    )
    assert res.status_code == 201, res.text

    res = client.delete(f"/api/v1/resale/listings/{listing['id']}", headers=seller_headers)
    assert res.status_code == 409


def test_failed_mpesa_payment_releases_listing_back_to_active(seller_headers, buyer_headers):
    event = _create_event(seller_headers, ticket_price_kes=1000)
    ticket_id = _purchase_and_mint(seller_headers, event["id"], "0711000001")
    listing = _list_ticket(seller_headers, ticket_id, 1000)

    res = client.post(
        f"/api/v1/resale/listings/{listing['id']}/buy",
        json={"phone_number": "0711000002"},
        headers=buyer_headers,
    )
    assert res.status_code == 201, res.text
    checkout_request_id = res.json()["checkout_request_id"]

    callback_body = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "test-merchant-fail",
                "CheckoutRequestID": checkout_request_id,
                "ResultCode": 1032,
                "ResultDesc": "Request cancelled by user",
            }
        }
    }
    res = client.post("/api/v1/payments/mpesa/callback", json=callback_body)
    assert res.status_code == 200

    transfer = _get_transfer(listing["id"])
    assert transfer.status.value == "listed"
    assert transfer.buyer_id is None

    # The listing is genuinely buyable again, not just marked as if it were.
    res = client.get(f"/api/v1/resale/listings/{listing['id']}")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
