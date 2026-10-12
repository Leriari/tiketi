"""
Payment flow:
  POST /payments/purchase     → STK push sent to user's phone
  POST /payments/mpesa/callback → Daraja confirms payment → ticket activated
  GET  /payments/{id}/status  → Poll payment status
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import (
    Event, EventTier, EventStatus, Ticket, Payment, Barcode,
    TicketStatus, PaymentStatus, BarcodeStatus, User, Transfer, TransferStatus,
)
from app.schemas.schemas import PurchaseRequest, PurchaseResponse, PaymentStatusOut
from app.services import mpesa as mpesa_service
from app.services.totp_service import generate_totp_secret
from app.core.crypto import encrypt_secret
from app.core.dependencies import get_current_user
from app.core.config import get_settings
from app.core.rate_limit import enforce_rate_limit
from app.worker import mint_ticket_nft, settle_resale_transfer

router = APIRouter(prefix="/payments", tags=["Payments"])
logger = logging.getLogger(__name__)
settings = get_settings()

# Work Order 04 A3 — a real STK push costs the user nothing to trigger but
# costs this backend a Daraja API call every time; 30 per 5 minutes is far
# above any legitimate buyer's rate (the resale test suite alone drives one
# user through ~15-20 purchases across its run) but still a real ceiling
# against a script hammering the endpoint.
_PURCHASE_LIMIT = (30, 300)


def _activate_ticket_for_payment(db: Session, payment: Payment, receipt_number: str) -> list[Ticket]:
    """
    Shared success path for a confirmed payment — used by both the real Daraja
    callback and the dev-only /dev-confirm endpoint below, so there is exactly
    one place that decides what "payment succeeded" means for a ticket.

    Activates every ticket this payment covers — the primary one
    (payment.ticket_id) plus any others bought alongside it in the same
    quantity>1 purchase (linked via Ticket.group_payment_id). Returns all of
    them so the caller can queue a mint for each.
    """
    payment.status = PaymentStatus.SUCCESS
    payment.mpesa_receipt_number = receipt_number
    payment.confirmed_at = datetime.now(timezone.utc)

    tickets = (
        db.query(Ticket)
        .filter((Ticket.id == payment.ticket_id) | (Ticket.group_payment_id == payment.id))
        .all()
    )
    if tickets:
        now = datetime.now(timezone.utc)
        for ticket in tickets:
            ticket.status = TicketStatus.ACTIVE
            ticket.purchased_at = now

        event = db.query(Event).filter(Event.id == tickets[0].event_id).first()
        if event:
            event.tickets_sold += len(tickets)
        if tickets[0].tier:
            tickets[0].tier.tickets_sold += len(tickets)

    return tickets


def _handle_payment_success(db: Session, payment: Payment, receipt_number: str) -> tuple[list[Ticket], Transfer | None]:
    """
    Shared success path covering BOTH kinds of payment this app has: an
    original ticket purchase, and (Work Order 02) a resale purchase. Used by
    both the real Daraja callback and /dev-confirm below.

    Returns (tickets, None) for an original purchase — caller should queue
    mint_ticket_nft for each ticket (usually one, more if quantity>1).
    Returns ([], transfer) for a resale purchase — caller should queue
    settle_resale_transfer(transfer.id) instead. The ticket is deliberately
    NOT re-activated or re-counted here: it's already ACTIVE and was already
    counted in the event's tickets_sold at its original purchase — doing so
    again would double-count capacity.
    """
    transfer = db.query(Transfer).filter(Transfer.payment_id == payment.id).first()
    if transfer:
        payment.status = PaymentStatus.SUCCESS
        payment.mpesa_receipt_number = receipt_number
        payment.confirmed_at = datetime.now(timezone.utc)
        transfer.status = TransferStatus.PAID
        return [], transfer

    return _activate_ticket_for_payment(db, payment, receipt_number), None


@router.post("/purchase", response_model=PurchaseResponse, status_code=status.HTTP_201_CREATED)
async def purchase_ticket(
    body: PurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initiate ticket purchase — one or more tickets (body.quantity) in a
    single payment.
    1. Validates event/tier availability for the whole quantity
    2. Creates `quantity` PENDING tickets + one payment record covering all of them
    3. Sends one M-Pesa STK push, for the total amount, to the user's phone

    A user may buy more than once for the same event, and more than once
    concurrently — there is no one-active-ticket-per-event restriction.
    """
    enforce_rate_limit(f"purchase:user:{current_user.id}", *_PURCHASE_LIMIT)

    # ── 1. Validate event ────────────────────────────────────────────────────
    event = db.query(Event).filter(Event.id == body.event_id, Event.status == EventStatus.PUBLISHED).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.tickets_remaining < body.quantity:
        raise HTTPException(status_code=400, detail="Not enough tickets remaining for this event")

    # ── 1b. Resolve the ticket tier ──────────────────────────────────────────
    if body.tier_id:
        tier = db.query(EventTier).filter(EventTier.id == body.tier_id, EventTier.event_id == event.id).first()
        if not tier:
            raise HTTPException(status_code=404, detail="Ticket tier not found")
    else:
        tier = event.default_tier
    if not tier:
        raise HTTPException(status_code=400, detail="Event has no ticket tier configured")

    if tier.tickets_remaining < body.quantity:
        raise HTTPException(status_code=400, detail="Not enough tickets remaining in this tier")

    # ── 2. Create `quantity` pending tickets, each with its own credential ──
    tickets = []
    for _ in range(body.quantity):
        ticket = Ticket(
            event_id=event.id,
            tier_id=tier.id,
            owner_id=current_user.id,
            status=TicketStatus.PENDING_PAYMENT,
        )
        db.add(ticket)
        db.flush()  # get ticket.id without committing

        # The credential seed now lives on a Barcode row rather than a Ticket
        # column — see Ticket.current_barcode / Ticket.totp_secret in models.py.
        barcode = Barcode(
            ticket_id=ticket.id,
            event_id=event.id,
            owner_id=current_user.id,
            token=encrypt_secret(generate_totp_secret()),
            token_version=1,
            status=BarcodeStatus.ACTIVE,
        )
        db.add(barcode)
        tickets.append(ticket)
    db.flush()

    primary_ticket = tickets[0]
    total_amount = tier.price_kes * body.quantity

    # ── 3. Create one payment record covering the whole quantity ────────────
    payment = Payment(
        ticket_id=primary_ticket.id,
        tier_id=tier.id,
        user_id=current_user.id,
        amount_kes=total_amount,
        quantity=body.quantity,
        phone_number=body.phone_number,
        status=PaymentStatus.INITIATED,
    )
    db.add(payment)
    db.flush()

    # Link the rest of the batch back to this payment (the primary ticket is
    # already linked via payment.ticket_id above).
    for ticket in tickets[1:]:
        ticket.group_payment_id = payment.id
    db.flush()

    # ── 4. Send STK Push ─────────────────────────────────────────────────────
    try:
        daraja_response = await mpesa_service.stk_push(
            phone_number=body.phone_number,
            amount=int(total_amount),
            account_reference=primary_ticket.id[:12],
            transaction_desc=f"Ticket: {event.title[:13]}",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"STK push failed: {e}")
        raise HTTPException(status_code=502, detail=f"M-Pesa request failed: {str(e)}")

    # ── 5. Store Daraja request IDs ──────────────────────────────────────────
    payment.merchant_request_id = daraja_response.get("MerchantRequestID")
    payment.checkout_request_id = daraja_response.get("CheckoutRequestID")

    db.commit()
    db.refresh(payment)

    return PurchaseResponse(
        ticket_id=primary_ticket.id,
        ticket_ids=[t.id for t in tickets],
        payment_id=payment.id,
        checkout_request_id=payment.checkout_request_id,
    )


@router.post("/mpesa/callback", include_in_schema=False)
async def mpesa_callback(request: Request, db: Session = Depends(get_db)):
    """
    Safaricom Daraja POSTs payment result here.
    This endpoint must be publicly accessible (no auth).
    Always return 200 to Daraja regardless of processing result.
    """
    try:
        body = await request.json()
        logger.info(f"M-Pesa callback received: {body}")

        parsed = mpesa_service.parse_callback(body)
        checkout_id = parsed.get("checkout_request_id")

        payment = (
            db.query(Payment)
            .filter(Payment.checkout_request_id == checkout_id)
            .first()
        )

        if not payment:
            logger.warning(f"No payment found for CheckoutRequestID: {checkout_id}")
            return {"ResultCode": 0, "ResultDesc": "Accepted"}

        minted_tickets = []
        paid_transfer = None

        if parsed["success"]:
            # ── Payment confirmed ────────────────────────────────────────────
            minted_tickets, paid_transfer = _handle_payment_success(db, payment, parsed["receipt_number"])
            if minted_tickets:
                logger.info(f"{len(minted_tickets)} ticket(s) activated for payment {payment.id}. Receipt: {parsed['receipt_number']}")
            elif paid_transfer:
                logger.info(f"Resale transfer {paid_transfer.id} paid. Receipt: {parsed['receipt_number']}")

        else:
            # ── Payment failed ───────────────────────────────────────────────
            payment.status = PaymentStatus.FAILED
            payment.failure_reason = parsed.get("result_desc", "Unknown failure")

            transfer = db.query(Transfer).filter(Transfer.payment_id == payment.id).first()
            if transfer:
                # Release the listing back to the seller rather than
                # cancelling anything — the ticket was never touched.
                transfer.status = TransferStatus.LISTED
                transfer.buyer_id = None
            else:
                tickets = (
                    db.query(Ticket)
                    .filter((Ticket.id == payment.ticket_id) | (Ticket.group_payment_id == payment.id))
                    .all()
                )
                for ticket in tickets:
                    ticket.status = TicketStatus.CANCELLED

            logger.info(f"Payment failed for payment {payment.id}: {payment.failure_reason}")

        db.commit()

        for ticket in minted_tickets:
            mint_ticket_nft.delay(ticket.id)
        if paid_transfer:
            settle_resale_transfer.delay(paid_transfer.id)

    except Exception as e:
        logger.error(f"Callback processing error: {e}", exc_info=True)

    # Always return 200 to Daraja
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.get("/{payment_id}/status", response_model=PaymentStatusOut)
def get_payment_status(
    payment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Poll payment status — used by the frontend while waiting for M-Pesa confirmation."""
    payment = (
        db.query(Payment)
        .filter(Payment.id == payment_id, Payment.user_id == current_user.id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.post(
    "/{payment_id}/dev-confirm",
    response_model=PaymentStatusOut,
    include_in_schema=settings.APP_ENV == "development",
    summary="DEV ONLY — manually confirm a payment without a real M-Pesa callback",
)
def dev_confirm_payment(
    payment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Safaricom's sandbox can't reach `localhost` without a live ngrok tunnel, so
    without this, a purchase hangs forever waiting for a callback that never
    arrives. This runs the exact same activation logic as the real Daraja
    callback (`_activate_ticket_for_payment`) — a manual trigger for that same
    code path, not a separate one. Hidden from the OpenAPI docs and hard-blocked
    outside development regardless of that, since include_in_schema only hides
    a route, it doesn't disable it.
    """
    if settings.APP_ENV != "development":
        raise HTTPException(status_code=404, detail="Not found")

    payment = (
        db.query(Payment)
        .filter(Payment.id == payment_id, Payment.user_id == current_user.id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != PaymentStatus.INITIATED:
        raise HTTPException(status_code=400, detail=f"Payment already {payment.status.value}")

    tickets, transfer = _handle_payment_success(db, payment, receipt_number=f"DEV{payment.id[:8].upper()}")
    db.commit()
    db.refresh(payment)

    if tickets:
        logger.info(f"[DEV] Payment {payment.id} manually confirmed. {len(tickets)} ticket(s) activated.")
        for ticket in tickets:
            mint_ticket_nft.delay(ticket.id)
    elif transfer:
        logger.info(f"[DEV] Resale payment {payment.id} manually confirmed. Transfer {transfer.id} paid.")
        settle_resale_transfer.delay(transfer.id)

    return payment
