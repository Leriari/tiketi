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
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, object_session

from app.db.session import get_db
from app.models.models import (
    Ticket, TicketStatus, Transfer, TransferStatus, TransferType,
    Payment, PaymentStatus, WalletTransaction, WalletTransactionType,
    WalletTransactionStatus, User, AuditLog, EventStatus, Payout, PayoutStatus,
)
from app.schemas.schemas import (
    ResaleListingCreate, ResaleRepriceRequest, ResaleBuyRequest, ResaleWithdrawRequest,
)
from app.core.config import get_settings
from app.core.constants import PAYOUT_CHARGE_BANDS
from app.services import mpesa as mpesa_service
from app.services import payouts as payout_service
from app.services import web3_service
from app.core.dependencies import get_current_user
from app.services import organiser_service
from app.services.platform_settings import current_fees, flag_on

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


# ── Buying: what's for sale, and purchases that never completed ──────────────

# A buyer who never finishes the M-Pesa prompt would otherwise hold the
# listing in PENDING_PAYMENT forever. STK prompts expire on the phone within
# a couple of minutes; this leaves room for a slow callback.
RESALE_PAYMENT_TIMEOUT = timedelta(minutes=5)
_PUBLIC_EVENT_STATUSES = (EventStatus.PUBLISHED, EventStatus.SOLD_OUT)


def _release_stale_purchases(db: Session) -> None:
    """Put listings whose buyer never paid back on sale. Runs lazily
    whenever listings are read or bought, so no scheduler is needed."""
    cutoff = datetime.utcnow() - RESALE_PAYMENT_TIMEOUT
    stale = (
        db.query(Transfer)
        .join(Payment, Transfer.payment_id == Payment.id)
        .filter(
            Transfer.status == TransferStatus.PENDING_PAYMENT,
            Payment.status == PaymentStatus.INITIATED,
            Payment.initiated_at < cutoff,
        )
        .all()
    )
    for transfer in stale:
        transfer.payment.status = PaymentStatus.TIMEOUT
        transfer.payment.failure_reason = "The M-Pesa payment wasn't completed in time."
        transfer.status = TransferStatus.LISTED
        transfer.buyer_id = None
        transfer.payment_id = None
    if stale:
        db.commit()


def _buy_block_reason(transfer: Transfer) -> str | None:
    """Why this listing can't be bought right now (beyond its own status),
    or None. Applies the organiser's resale settings at purchase time too."""
    event = transfer.event
    if not event or event.status not in _PUBLIC_EVENT_STATUSES:
        return "This event isn't on sale right now"
    if organiser_service.organisation_suspended(object_session(transfer), event):
        return "This event isn't on sale right now"
    now = datetime.utcnow()
    if event.event_date <= now:
        return "This event has already started"
    if event.resale_enabled is False:
        return "The organiser has turned off resale for this event"
    if event.resale_window_close_hours and now > event.event_date - timedelta(hours=event.resale_window_close_hours):
        return f"Resale closed {event.resale_window_close_hours} hour(s) before the event"
    return None


# ── Organiser resale rules (Organiser Console → Event Management) ───────────

def _resale_rule_reason(ticket: Ticket) -> str | None:
    """Why the organiser's resale settings block listing this ticket right
    now, or None. Naive-UTC comparisons, same reasoning as _eligible_ticket."""
    event = ticket.event
    if not event:
        return None
    if event.resale_enabled is False:
        return "The organiser has turned off resale for this event"
    now = datetime.utcnow()
    if event.resale_window_open_days and ticket.purchased_at:
        opens_at = ticket.purchased_at.replace(tzinfo=None) + timedelta(days=event.resale_window_open_days)
        if now < opens_at:
            return f"Resale opens {event.resale_window_open_days} day(s) after purchase"
    if event.resale_window_close_hours and event.event_date:
        if now > event.event_date - timedelta(hours=event.resale_window_close_hours):
            return f"Resale closed {event.resale_window_close_hours} hour(s) before the event"
    return None


def _log_rejected_listing(db: Session, user_id: str, ticket: Ticket, price_kes: float, message: str) -> None:
    """Record a chain-rejected listing price so the organiser's Resale
    Compliance page counts real blocked attempts, not a guess."""
    db.add(AuditLog(
        actor_id=user_id,
        action_type="resale_rejected_above_cap" if "cap" in message.lower() else "resale_rejected",
        target_id=ticket.event_id,
        target_type="event",
        details=f"ticket={ticket.id} price_kes={int(round(price_kes))} reason={message}",
    ))
    db.commit()


# ── Serialization helpers ───────────────────────────────────────────────────

def _fee_split(price_kes: float, royalty_percent: float, platform_fee_percent: float) -> tuple[float, float, float]:
    """
    royalty_kes, platform_fee_kes, payout_kes. payout_kes is defined as the
    remainder (price minus the other two, each independently rounded) so the
    three always sum to price_kes exactly — no wei/cent lost to rounding.
    """
    royalty_kes = round(price_kes * royalty_percent / 100)
    platform_fee_kes = round(price_kes * platform_fee_percent / 100)
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
            price, tier.organizer_royalty_percent if tier else 0.0,
            current_fees(object_session(transfer)).platform_fee_percent,
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
        "category": event.category if event else None,
        "image_url": event.image_url if event else None,
        "tier_name": tier.tier_name if tier else None,
        "face_value_kes": tier.price_kes if tier else None,
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
    else:
        reason = _resale_rule_reason(ticket)

    return {
        "ticket_id": ticket.id,
        "event_id": ticket.event_id,
        "event_title": event.title if event else None,
        "venue": event.venue if event else None,
        "event_date": event.event_date if event else None,
        "category": (event.category if event and event.category else "general"),
        "image_url": event.image_url if event else None,
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
            if t.status != WalletTransactionStatus.FAILED:  # a failed withdrawal's money is back
                available += t.amount_kes  # stored negative already
        elif t.available_at and t.available_at <= now:
            available += t.amount_kes
        else:
            pending += t.amount_kes
    return {"available": available, "pending": pending, "onHold": 0.0}


def _serialize_wallet_transaction(t: WalletTransaction, include_available_at: bool,
                                  payouts: dict[str, Payout] | None = None) -> dict:
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
    payout = (payouts or {}).get(t.id)
    if payout:
        row["payout"] = payout_service.serialize(payout)
    return row


def _withdrawal_payouts(db: Session, user_id: str) -> dict[str, Payout]:
    """Each withdrawal's Payout, by its wallet transaction id."""
    rows = db.query(Payout).filter(Payout.user_id == user_id, Payout.recipient_type == "seller").all()
    return {p.wallet_transaction_id: p for p in rows if p.wallet_transaction_id}


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
    if not flag_on(db, "resale_marketplace", current_user.id):
        raise HTTPException(status_code=403, detail="Resale isn't available on your account right now.")
    if ticket.status == TicketStatus.USED:
        raise HTTPException(status_code=400, detail="This ticket has already been used")
    if ticket.status == TicketStatus.RESALE:
        raise HTTPException(status_code=400, detail="This ticket is already listed for resale")
    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="This ticket isn't active")
    if not ticket.nft_token_id:
        raise HTTPException(status_code=409, detail="This ticket hasn't finished minting yet — try again shortly")
    rule_reason = _resale_rule_reason(ticket)
    if rule_reason:
        raise HTTPException(status_code=400, detail=rule_reason)

    # The chain, not this function, decides whether the price is allowed.
    try:
        tx_hash = web3_service.list_for_resale_onchain(ticket.nft_token_id, int(round(body.price_kes)))
    except web3_service.ContractRevertError as e:
        _log_rejected_listing(db, current_user.id, ticket, body.price_kes, str(e))
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
def browse_listings(event_id: str | None = None, sort: str = "price", db: Session = Depends(get_db)):
    """Listings a buyer can actually buy right now: on sale, for a public
    event that hasn't started, with resale open. sort: price | newest | date."""
    _release_stale_purchases(db)
    query = db.query(Transfer).filter(Transfer.status == TransferStatus.LISTED)
    if event_id:
        query = query.filter(Transfer.event_id == event_id)
    transfers = [t for t in query.all() if _buy_block_reason(t) is None]
    if sort == "newest":
        transfers.sort(key=lambda t: t.created_at, reverse=True)
    elif sort == "date":
        transfers.sort(key=lambda t: (t.event.event_date, t.asking_price_kes))
    else:
        transfers.sort(key=lambda t: (t.asking_price_kes, t.created_at))
    return [_serialize_listing(t) for t in transfers]


@router.get("/listings/{listing_id}")
def get_listing(listing_id: str, db: Session = Depends(get_db)):
    _release_stale_purchases(db)
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    transfer.views += 1
    db.commit()
    db.refresh(transfer)
    data = _serialize_listing(transfer)
    reason = _buy_block_reason(transfer) if transfer.status == TransferStatus.LISTED else "This ticket is no longer available"
    data["buyable"] = reason is None
    data["unavailable_reason"] = reason
    return data


@router.get("/purchases/{payment_id}")
def get_resale_purchase(payment_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    A buyer's view of their resale purchase, polled after paying. Paying
    isn't the end: the ticket moves to the buyer once the on-chain
    settlement finishes (app/worker.py settle_resale_transfer).

    status: awaiting_payment | failed | transferring | complete | delayed
    """
    _release_stale_purchases(db)
    payment = db.query(Payment).filter(Payment.id == payment_id, Payment.user_id == current_user.id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Purchase not found")
    transfer = db.query(Transfer).filter(Transfer.payment_id == payment.id).first()

    if payment.status in (PaymentStatus.FAILED, PaymentStatus.TIMEOUT) or (payment.status == PaymentStatus.INITIATED and not transfer):
        status_ = "failed"
    elif payment.status == PaymentStatus.INITIATED:
        status_ = "awaiting_payment"
    elif transfer and transfer.status == TransferStatus.COMPLETED:
        status_ = "complete"
    elif transfer and transfer.status == TransferStatus.SETTLEMENT_FAILED:
        status_ = "delayed"
    else:
        status_ = "transferring"

    return {
        "payment_id": payment.id,
        "status": status_,
        "failure_reason": payment.failure_reason if status_ == "failed" else None,
        "ticket_id": transfer.ticket_id if transfer and status_ == "complete" else None,
        "listing": _serialize_listing(transfer) if transfer else None,
    }


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
        _log_rejected_listing(db, current_user.id, ticket, body.price_kes, str(e))
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
    if not flag_on(db, "resale_marketplace"):
        raise HTTPException(status_code=403, detail="Resale purchases are paused right now.")
    _release_stale_purchases(db)
    transfer = db.query(Transfer).filter(Transfer.id == listing_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Listing not found")
    # The same buyer retrying (their M-Pesa prompt timed out, they tapped
    # Resend) replaces their own unfinished attempt rather than being
    # locked out of a listing they're holding.
    previous = transfer.payment
    if (
        transfer.status == TransferStatus.PENDING_PAYMENT
        and transfer.buyer_id == current_user.id
        and previous is not None
        and previous.status == PaymentStatus.INITIATED
    ):
        previous.status = PaymentStatus.TIMEOUT
        previous.failure_reason = "Replaced by a new payment attempt."
        transfer.status = TransferStatus.LISTED
        transfer.buyer_id = None
        transfer.payment_id = None
        db.flush()
    if transfer.status != TransferStatus.LISTED:
        # Covers both "someone else is already mid-purchase" and any other
        # non-buyable state — the second buyer is rejected, not queued.
        raise HTTPException(status_code=409, detail="This listing is no longer available")
    if transfer.seller_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot buy your own listing")
    reason = _buy_block_reason(transfer)
    if reason:
        raise HTTPException(status_code=400, detail=reason)

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
    payouts = _withdrawal_payouts(db, current_user.id)
    return {
        "available": wallet["available"],
        "pending": wallet["pending"],
        "onHold": wallet["onHold"],
        "minWithdrawalKes": current_fees(db).min_payout_kes,
        # Withdrawals go to the account's own M-Pesa number.
        "withdrawalPhone": current_user.phone_number,
        # True: sent by M-Pesa straight away. False: an admin pays it by hand.
        "instantWithdrawals": get_settings().MPESA_PAYOUTS_CONFIGURED,
        # M-Pesa's charge per withdrawal, taken off the amount: [[up to KES, charge], ...].
        "transferCharges": [list(band) for band in PAYOUT_CHARGE_BANDS],
        "transactions": [_serialize_wallet_transaction(t, include_available_at=True, payouts=payouts) for t in transactions],
    }


@router.post("/withdraw")
async def withdraw_to_mpesa(
    body: ResaleWithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Withdraw any amount of the available balance to the seller's own M-Pesa
    number. With M-Pesa payouts set up, it goes out by B2C straight away;
    otherwise an admin pays it (app/services/payouts.py). The money leaves
    the balance now and comes back if the payout fails.
    """
    # Lock the seller's row so two withdrawals at once can't both pass the
    # balance check (Postgres; SQLite has no row locks and runs one writer).
    user = db.query(User).filter(User.id == current_user.id).with_for_update().one()
    wallet = _compute_wallet(db, user.id)
    try:
        payout_service.check_amount(body.amount_kes, wallet["available"], current_fees(db).min_payout_kes)
    except payout_service.PayoutError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payout = payout_service.create_seller_withdrawal(db, user, body.amount_kes)
    db.commit()
    if payout.status == PayoutStatus.PROCESSING:
        await payout_service.send(db, payout)
    db.refresh(payout)
    return payout_service.serialize(payout)


@router.get("/disputes")
def get_disputes():
    """
    No dispute system exists in this schema or this work order's scope.
    Returns an empty list unconditionally — an honest match, not a stub:
    the mock this replaces never populates a real dispute either.
    """
    return []
