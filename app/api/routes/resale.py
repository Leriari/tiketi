"""
Resale marketplace (Work Order 02).

The central rule this whole module is built around: the resale price cap is
enforced by the smart contract, never by Python. Every endpoint that sets or
changes a listing price calls web3_service.list_for_resale_onchain and lets
whatever it returns — success or a ContractRevertError — decide the outcome.
Nothing here pre-validates a price against the cap and skips that call.

Status vocabulary returned to the frontend is deliberately narrower than the
internal TransferStatus enum — see _FRONTEND_STATUS. The Seller Portal UI
was built against a mock that used a 6-value status vocabulary
(pending_review/active/sold/paused/cancelled/expired); this backend has a
richer internal state machine (notably PENDING_PAYMENT and
SETTLEMENT_FAILED, which the UI has no concept of), so internal states get
mapped down to whichever of the six UI values is the closest honest match.
See the Work Order 02 completion report for the full mapping rationale.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import (
    Ticket, TicketStatus, Transfer, TransferStatus, TransferType,
    Payment, PaymentStatus, WalletTransaction, WalletTransactionType,
    WalletTransactionStatus, User,
)
from app.schemas.schemas import (
    ResaleListingCreate, ResaleRepriceRequest, ResaleBuyRequest, ResaleWithdrawRequest,
)
from app.services import mpesa as mpesa_service
from app.services import web3_service
from app.core.dependencies import get_current_user
from app.core.constants import PLATFORM_FEE_PERCENT, MIN_WITHDRAWAL_KES

router = APIRouter(prefix="/resale", tags=["Resale"])
logger = logging.getLogger(__name__)

_FRONTEND_STATUS = {
    TransferStatus.LISTED: "active",
    TransferStatus.PAUSED: "paused",
    TransferStatus.PENDING_PAYMENT: "active",
    TransferStatus.PAID: "sold",
    TransferStatus.COMPLETED: "sold",
    TransferStatus.CANCELLED: "cancelled",
    TransferStatus.EXPIRED: "expired",
    TransferStatus.SETTLEMENT_FAILED: "sold",
}

_SETTLED_STATUSES = (TransferStatus.PAID, TransferStatus.COMPLETED, TransferStatus.SETTLEMENT_FAILED)


# ── Serialization helpers ───────────────────────────────────────────────────

def _fee_split(price_kes: float, royalty_percent: float) -> tuple[float, float, float]:
    """
    royalty_kes, platform_fee_kes, payout_kes. payout_kes is defined as the
    remainder (price minus the other two, each independently rounded) so the
    three always sum to price_kes exactly — no wei/cent lost to rounding.
    """
    royalty_kes = round(price_kes * royalty_percent / 100)
    platform_fee_kes = round(price_kes * PLATFORM_FEE_PERCENT / 100)
    payout_kes = price_kes - royalty_kes - platform_fee_kes
    return royalty_kes, platform_fee_kes, payout_kes


def _serialize_listing(transfer: Transfer) -> dict:
    ticket = transfer.ticket
    tier = ticket.tier if ticket else None
    event = transfer.event

    if transfer.status in _SETTLED_STATUSES:
        # Frozen at settlement — the real, final numbers, not a live hint.
        price = transfer.transfer_price_kes or transfer.asking_price_kes
        royalty_kes = transfer.organizer_royalty_kes or 0.0
        platform_fee_kes = transfer.platform_fee_kes or 0.0
        payout_kes = transfer.seller_payout_kes or 0.0
    else:
        # Still just a listing — royalty/fee/payout are a live-computed
        # hint the seller sees before any money has moved, matching the
        # UI's own "guidance, not a gate" framing for the price cap.
        price = transfer.asking_price_kes
        royalty_kes, platform_fee_kes, payout_kes = _fee_split(
            price, tier.organizer_royalty_percent if tier else 0.0
        )

    return {
        "id": transfer.id,
        "ticket_id": transfer.ticket_id,
        "status": _FRONTEND_STATUS[transfer.status],
        "price": price,
        "payout_kes": payout_kes,
        "royalty_kes": royalty_kes,
        "platform_fee_kes": platform_fee_kes,
        "views": transfer.views,
        "listed_at": transfer.created_at,
        "sold_at": transfer.transferred_at,
        "pause_reason": transfer.pause_reason,
        "event_id": transfer.event_id,
        "event_title": event.title if event else None,
        "event_date": event.event_date if event else None,
        "venue": event.venue if event else None,
        "tier_name": tier.tier_name if tier else None,
        "resale_floor_kes": tier.resale_floor_price_kes if tier else 0.0,
        "resale_ceiling_kes": tier.resale_ceiling_price_kes if tier else 0.0,
        "checked_in": ticket.status == TicketStatus.USED if ticket else False,
    }


def _eligible_ticket(ticket: Ticket) -> dict:
    event = ticket.event
    tier = ticket.tier
    reason = None

    if ticket.status == TicketStatus.USED:
        reason = "Already used"
    elif ticket.status == TicketStatus.RESALE:
        reason = "Already listed for resale"
    elif ticket.status != TicketStatus.ACTIVE:
        reason = "Payment not yet confirmed"
    elif event and event.event_date <= datetime.utcnow():
        # Naive comparison deliberately — event_date round-trips through
        # SQLite as naive, and comparing it against an aware "now" raises.
        reason = "Event has ended"

    return {
        "ticket_id": ticket.id,
        "event_id": ticket.event_id,
        "event_title": event.title if event else None,
        "venue": event.venue if event else None,
        "event_date": event.event_date if event else None,
        # No "category" concept exists in this schema (Event has no such
        # column) — a fixed default rather than a schema change for a
        # purely decorative field. See the completion report.
        "category": "general",
        "tier_name": tier.tier_name if tier else None,
        "floor": tier.resale_floor_price_kes if tier else 0.0,
        "ceiling": tier.resale_ceiling_price_kes if tier else 0.0,
        "royalty_percent": tier.organizer_royalty_percent if tier else 0.0,
        "eligible": reason is None,
        "ineligible_reason": reason,
    }


def _wallet_transactions(db: Session, user_id: str) -> list[WalletTransaction]:
    return (
        db.query(WalletTransaction)
        .filter(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc())
        .all()
    )


def _compute_wallet(db: Session, user_id: str) -> dict:
    """
    available/pending split by each sale's available_at (event date + 2
    days — see WalletTransaction's docstring). onHold stays permanently 0:
    no dispute system exists in this work order's scope, so nothing ever
    feeds it (the mock's own dispute list is always empty too — see the
    completion report).
    """
    now = datetime.utcnow()  # naive — see _eligible_ticket's note
    available = 0.0
    pending = 0.0
    for t in _wallet_transactions(db, user_id):
        if t.type == WalletTransactionType.WITHDRAWAL:
            available += t.amount_kes  # stored negative already
        elif t.available_at and t.available_at <= now:
            available += t.amount_kes
        else:
            pending += t.amount_kes
    return {"available": available, "pending": pending, "onHold": 0.0}


def _serialize_wallet_transaction(t: WalletTransaction, include_available_at: bool) -> dict:
    row = {
        "id": t.id,
        "type": t.type.value,
        "description": t.description,
        "amount": t.amount_kes,
        "status": t.status.value,
        "created_at": t.created_at,
    }
    if include_available_at:
        row["available_at"] = t.available_at
    return row


# ── Eligible tickets / listing creation ─────────────────────────────────────

@router.get("/eligible-tickets")
def get_eligible_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tickets = db.query(Ticket).filter(Ticket.owner_id == current_user.id).all()
    result = [_eligible_ticket(t) for t in tickets]
    result.sort(key=lambda t: not t["eligible"])
    return result


@router.post("/listings", status_code=status.HTTP_201_CREATED)
def create_listing(
    body: ResaleListingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == body.ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status == TicketStatus.USED:
        raise HTTPException(status_code=400, detail="This ticket has already been used")
    if ticket.status == TicketStatus.RESALE:
        raise HTTPException(status_code=400, detail="This ticket is already listed for resale")
    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="This ticket isn't active")
    if not ticket.nft_token_id:
        raise HTTPException(status_code=409, detail="This ticket hasn't finished minting yet — try again shortly")

    # The chain, not this function, decides whether the price is allowed.
    try:
        tx_hash = web3_service.list_for_resale_onchain(ticket.nft_token_id, int(round(body.price_kes)))
    except web3_service.ContractRevertError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    ticket.status = TicketStatus.RESALE
    transfer = Transfer(
        ticket_id=ticket.id,
        event_id=ticket.event_id,
        seller_id=current_user.id,
        transfer_type=TransferType.RESALE,
        status=TransferStatus.LISTED,
        asking_price_kes=round(body.price_kes),
        listing_tx_hash=tx_hash,
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return _serialize_listing(transfer)


# ── Browse / view ────────────────────────────────────────────────────────────

@router.get("/listings")
def browse_listings(event_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Transfer).filter(Transfer.status == TransferStatus.LISTED)
    if event_id:
        query = query.filter(Transfer.event_id == event_id)
    transfers = query.order_by(Transfer.created_at.desc()).all()
    return [_serialize_listing(t) for t in transfers]


@router.get("/listings/{listing_id}")
def get_listing(listing_id: str, db: Session = Depends(get_db)):
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    transfer.views += 1
    db.commit()
    db.refresh(transfer)
    return _serialize_listing(transfer)


# ── Seller-owned listing management ─────────────────────────────────────────

@router.get("/my-listings")
def my_listings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    transfers = (
        db.query(Transfer)
        .filter(Transfer.seller_id == current_user.id)
        .order_by(Transfer.created_at.desc())
        .all()
    )
    return [_serialize_listing(t) for t in transfers]


@router.get("/my-sales")
def my_sales(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    transfers = (
        db.query(Transfer)
        .filter(Transfer.seller_id == current_user.id, Transfer.status.in_(_SETTLED_STATUSES))
        .order_by(Transfer.transferred_at.desc())
        .all()
    )
    return [_serialize_listing(t) for t in transfers]


@router.delete("/listings/{listing_id}")
def cancel_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    if transfer.seller_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only cancel your own listings")
    if transfer.status == TransferStatus.PENDING_PAYMENT:
        # Cancellation must lose to an in-flight payment (Work Order 02 §4).
        raise HTTPException(status_code=409, detail="A purchase is already in progress for this listing")
    if transfer.status not in (TransferStatus.LISTED, TransferStatus.PAUSED):
        raise HTTPException(status_code=400, detail=f"Listing is already {transfer.status.value}")

    transfer.status = TransferStatus.CANCELLED
    transfer.cancelled_at = datetime.now(timezone.utc)
    if transfer.ticket and transfer.ticket.status == TicketStatus.RESALE:
        transfer.ticket.status = TicketStatus.ACTIVE
    db.commit()
    db.refresh(transfer)
    return _serialize_listing(transfer)


@router.post("/listings/{listing_id}/pause")
def pause_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    if transfer.seller_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only pause your own listings")
    if transfer.status != TransferStatus.LISTED:
        raise HTTPException(status_code=400, detail=f"Listing is {transfer.status.value}, not active")

    transfer.status = TransferStatus.PAUSED
    transfer.pause_reason = "Paused by you."
    db.commit()
    db.refresh(transfer)
    return _serialize_listing(transfer)


@router.post("/listings/{listing_id}/reprice")
def reprice_listing(
    listing_id: str,
    body: ResaleRepriceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    if transfer.seller_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only reprice your own listings")
    if transfer.status not in (TransferStatus.LISTED, TransferStatus.PAUSED):
        raise HTTPException(status_code=400, detail=f"Listing is {transfer.status.value}, cannot be repriced")

    ticket = transfer.ticket
    if not ticket or not ticket.nft_token_id:
        raise HTTPException(status_code=409, detail="Ticket has no on-chain token")

    # Re-lists at the new price on-chain — re-running the exact same cap
    # check a fresh listing gets, not just a database update.
    try:
        tx_hash = web3_service.list_for_resale_onchain(ticket.nft_token_id, int(round(body.price_kes)))
    except web3_service.ContractRevertError as e:
        raise HTTPException(status_code=400, detail=str(e))

    transfer.asking_price_kes = round(body.price_kes)
    transfer.listing_tx_hash = tx_hash
    if transfer.status == TransferStatus.PAUSED:
        transfer.pause_reason = None
    transfer.status = TransferStatus.LISTED
    db.commit()
    db.refresh(transfer)
    return _serialize_listing(transfer)


# ── Buying a resale listing ──────────────────────────────────────────────────

@router.post("/listings/{listing_id}/buy", status_code=status.HTTP_201_CREATED)
async def buy_listing(
    listing_id: str,
    body: ResaleBuyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initiates an M-Pesa STK push for a listed resale ticket. Follows the
    same ordering as the primary purchase flow: create the pending records,
    send the STK push, return immediately — the callback (app/api/routes/
    payments.py's mpesa_callback / dev-confirm) does the rest.
    """
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    if transfer.status != TransferStatus.LISTED:
        # Covers both "someone else is already mid-purchase" and any other
        # non-buyable state — the second buyer is rejected, not queued.
        raise HTTPException(status_code=409, detail="This listing is no longer available")
    if transfer.seller_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot buy your own listing")

    payment = Payment(
        ticket_id=transfer.ticket_id,
        tier_id=transfer.ticket.tier_id if transfer.ticket else None,
        user_id=current_user.id,
        amount_kes=transfer.asking_price_kes,
        phone_number=body.phone_number,
        status=PaymentStatus.INITIATED,
    )
    db.add(payment)
    db.flush()

    transfer.buyer_id = current_user.id
    transfer.payment_id = payment.id
    transfer.status = TransferStatus.PENDING_PAYMENT

    event_title = transfer.event.title[:13] if transfer.event else "Ticket"
    try:
        daraja_response = await mpesa_service.stk_push(
            phone_number=body.phone_number,
            amount=int(transfer.asking_price_kes),
            account_reference=transfer.id[:12],
            transaction_desc=f"Resale: {event_title}",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Resale STK push failed: {e}")
        raise HTTPException(status_code=502, detail=f"M-Pesa request failed: {str(e)}")

    payment.merchant_request_id = daraja_response.get("MerchantRequestID")
    payment.checkout_request_id = daraja_response.get("CheckoutRequestID")
    db.commit()
    db.refresh(payment)

    return {
        "payment_id": payment.id,
        "checkout_request_id": payment.checkout_request_id,
        "message": "STK push sent. Confirm payment on your phone.",
    }


# ── Wallet / payouts ─────────────────────────────────────────────────────────

@router.get("/dashboard")
def seller_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    transfers = db.query(Transfer).filter(Transfer.seller_id == current_user.id).all()
    wallet = _compute_wallet(db, current_user.id)
    recent = _wallet_transactions(db, current_user.id)[:6]

    return {
        "stats": {
            "totalListings": len(transfers),
            # No moderation/review step exists in the real backend — the
            # on-chain listForResale call IS the validation, so nothing
            # ever sits "pending review". See the completion report.
            "pendingReview": 0,
            "liveListings": sum(1 for t in transfers if t.status in (TransferStatus.LISTED, TransferStatus.PAUSED)),
            "soldTickets": sum(1 for t in transfers if t.status in _SETTLED_STATUSES),
        },
        "wallet": {
            "available": wallet["available"],
            "pending": wallet["pending"],
            "onHold": wallet["onHold"],
        },
        "recentTransactions": [_serialize_wallet_transaction(t, include_available_at=False) for t in recent],
    }


@router.get("/wallet")
def get_wallet(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    wallet = _compute_wallet(db, current_user.id)
    transactions = _wallet_transactions(db, current_user.id)
    return {
        "available": wallet["available"],
        "pending": wallet["pending"],
        "onHold": wallet["onHold"],
        "minWithdrawalKes": MIN_WITHDRAWAL_KES,
        "transactions": [_serialize_wallet_transaction(t, include_available_at=True) for t in transactions],
    }


@router.post("/withdraw")
def withdraw_to_mpesa(
    body: ResaleWithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Real B2C M-Pesa payouts (Daraja's business-to-customer API) are not
    integrated — out of this work order's scope, and the mock this matches
    doesn't model one either (its own withdrawToMpesa is synchronous and
    always succeeds). This records the withdrawal for real; the actual
    money movement to a seller's phone is not implemented.
    """
    if body.amount_kes < MIN_WITHDRAWAL_KES:
        raise HTTPException(status_code=400, detail=f"Minimum withdrawal is KES {int(MIN_WITHDRAWAL_KES)}.")

    wallet = _compute_wallet(db, current_user.id)
    if body.amount_kes > wallet["available"]:
        raise HTTPException(status_code=400, detail="That's more than your available balance.")

    db.add(WalletTransaction(
        user_id=current_user.id,
        type=WalletTransactionType.WITHDRAWAL,
        description=f"Withdrawal to M-Pesa · {body.phone_number}",
        amount_kes=-round(body.amount_kes),
        status=WalletTransactionStatus.SUCCESS,
    ))
    db.commit()
    return {"success": True}


@router.get("/disputes")
def get_disputes():
    """
    No dispute system exists in this schema or this work order's scope.
    Returns an empty list unconditionally — an honest match, not a stub:
    the mock this replaces never populates a real dispute either.
    """
    return []
