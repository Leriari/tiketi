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
from app.core.dependencies import get_current_user
from app.core.config import get_settings
from app.worker import mint_ticket_nft, settle_resale_transfer

router = APIRouter(prefix="/payments", tags=["Payments"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _activate_ticket_for_payment(db: Session, payment: Payment, receipt_number: str) -> Ticket | None:
    """
    Shared success path for a confirmed payment — used by both the real Daraja
    callback and the dev-only /dev-confirm endpoint below, so there is exactly
    one place that decides what "payment succeeded" means for a ticket.
    """
    payment.status = PaymentStatus.SUCCESS
    payment.mpesa_receipt_number = receipt_number
    payment.confirmed_at = datetime.now(timezone.utc)

    ticket = db.query(Ticket).filter(Ticket.id == payment.ticket_id).first()
    if ticket:
        ticket.status = TicketStatus.ACTIVE
        ticket.purchased_at = datetime.now(timezone.utc)

        event = db.query(Event).filter(Event.id == ticket.event_id).first()
        if event:
            event.tickets_sold += 1
        if ticket.tier:
            ticket.tier.tickets_sold += 1

    return ticket


def _handle_payment_success(db: Session, payment: Payment, receipt_number: str) -> tuple[Ticket | None, Transfer | None]:
    """
    Shared success path covering BOTH kinds of payment this app has: an
    original ticket purchase, and (Work Order 02) a resale purchase. Used by
    both the real Daraja callback and /dev-confirm below.

    Returns (ticket, None) for an original purchase — caller should queue
    mint_ticket_nft(ticket.id).
    Returns (None, transfer) for a resale purchase — caller should queue
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
        return None, transfer

    return _activate_ticket_for_payment(db, payment, receipt_number), None


@router.post("/purchase", response_model=PurchaseResponse, status_code=status.HTTP_201_CREATED)
async def purchase_ticket(
    body: PurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initiate ticket purchase.
    1. Validates event availability
    2. Creates a PENDING ticket + payment record
    3. Sends M-Pesa STK push to the user's phone
    """
    # ── 1. Validate event ────────────────────────────────────────────────────
    event = db.query(Event).filter(Event.id == body.event_id, Event.status == EventStatus.PUBLISHED).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.tickets_remaining <= 0:
        raise HTTPException(status_code=400, detail="Event is sold out")

    # ── 1b. Resolve the ticket tier ──────────────────────────────────────────
    if body.tier_id:
        tier = db.query(EventTier).filter(EventTier.id == body.tier_id, EventTier.event_id == event.id).first()
        if not tier:
            raise HTTPException(status_code=404, detail="Ticket tier not found")
    else:
        tier = event.default_tier
    if not tier:
        raise HTTPException(status_code=400, detail="Event has no ticket tier configured")

    # ── 2. Check user doesn't already hold an active ticket for this event ───
    existing = (
        db.query(Ticket)
        .filter(
            Ticket.event_id == body.event_id,
            Ticket.owner_id == current_user.id,
            Ticket.status.in_([TicketStatus.ACTIVE, TicketStatus.PENDING_PAYMENT]),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have a ticket for this event")

    # ── 3. Generate TOTP secret & create pending ticket ──────────────────────
    totp_secret = generate_totp_secret()

    ticket = Ticket(
        event_id=event.id,
        tier_id=tier.id,
        owner_id=current_user.id,
        status=TicketStatus.PENDING_PAYMENT,
    )
    db.add(ticket)
    db.flush()  # get ticket.id without committing

    # The credential seed now lives on a Barcode row rather than a Ticket column —
    # see Ticket.current_barcode / Ticket.totp_secret in app/models/models.py.
    barcode = Barcode(
        ticket_id=ticket.id,
        event_id=event.id,
        owner_id=current_user.id,
        token=totp_secret,
        token_version=1,
        status=BarcodeStatus.ACTIVE,
    )
    db.add(barcode)
    db.flush()

    # ── 4. Create payment record ─────────────────────────────────────────────
    payment = Payment(
        ticket_id=ticket.id,
        tier_id=tier.id,
        user_id=current_user.id,
        amount_kes=tier.price_kes,
        phone_number=body.phone_number,
        status=PaymentStatus.INITIATED,
    )
    db.add(payment)
    db.flush()

    # ── 5. Send STK Push ─────────────────────────────────────────────────────
    try:
        daraja_response = await mpesa_service.stk_push(
            phone_number=body.phone_number,
            amount=int(tier.price_kes),
            account_reference=ticket.id[:12],
            transaction_desc=f"Ticket: {event.title[:13]}",
        )
    except Exception as e:
        db.rollback()
        logger.error(f"STK push failed: {e}")
        raise HTTPException(status_code=502, detail=f"M-Pesa request failed: {str(e)}")

    # ── 6. Store Daraja request IDs ──────────────────────────────────────────
    payment.merchant_request_id = daraja_response.get("MerchantRequestID")
    payment.checkout_request_id = daraja_response.get("CheckoutRequestID")

    db.commit()
    db.refresh(ticket)
    db.refresh(payment)

    return PurchaseResponse(
        ticket_id=ticket.id,
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

        minted_ticket = None
        paid_transfer = None

        if parsed["success"]:
            # ── Payment confirmed ────────────────────────────────────────────
            minted_ticket, paid_transfer = _handle_payment_success(db, payment, parsed["receipt_number"])
            if minted_ticket:
                logger.info(f"Ticket {minted_ticket.id} activated. Receipt: {parsed['receipt_number']}")
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
                ticket = db.query(Ticket).filter(Ticket.id == payment.ticket_id).first()
                if ticket:
                    ticket.status = TicketStatus.CANCELLED

            logger.info(f"Payment failed for payment {payment.id}: {payment.failure_reason}")

        db.commit()

        if minted_ticket:
            mint_ticket_nft.delay(minted_ticket.id)
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

    ticket, transfer = _handle_payment_success(db, payment, receipt_number=f"DEV{payment.id[:8].upper()}")
    db.commit()
    db.refresh(payment)

    if ticket:
        logger.info(f"[DEV] Payment {payment.id} manually confirmed. Ticket {ticket.id} activated.")
        mint_ticket_nft.delay(ticket.id)
    elif transfer:
        logger.info(f"[DEV] Resale payment {payment.id} manually confirmed. Transfer {transfer.id} paid.")
        settle_resale_transfer.delay(transfer.id)

    return payment
