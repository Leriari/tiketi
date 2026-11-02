"""
Payment flow:
  POST /payments/purchase     → STK push sent to user's phone, or (method
                                "card") a Paystack Checkout page to send them to
  POST /payments/mpesa/callback/{id}/{token} → Daraja confirms payment → ticket activated
  POST /payments/paystack/webhook → Paystack confirms a card payment → same
  GET  /payments/{id}/status  → Poll payment status (for a card payment,
                                also asks Paystack, so no webhook is needed)
  POST /payments/{id}/cancel  → The buyer cancelled on Paystack's page
"""
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import (
    Event, EventTier, EventStatus, Ticket, Payment, Barcode,
    TicketStatus, PaymentStatus, BarcodeStatus, User, Transfer, TransferStatus,
)
from app.schemas.schemas import PurchaseRequest, PurchaseResponse, PaymentStatusOut
from app.services import mpesa as mpesa_service
from app.services import paystack_service
from app.services.paystack_service import PaystackError
from app.services.totp_service import generate_totp_secret
from app.core.crypto import encrypt_secret
from app.core.dependencies import get_current_user
from app.core.config import get_settings
from app.core.rate_limit import enforce_rate_limit
from app.services import organiser_service
from app.services.platform_settings import flag_on
from app.worker import mint_ticket_nft, send_payment_receipt, settle_resale_transfer

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


def _handle_payment_failure(db: Session, payment: Payment, reason: str) -> None:
    """Shared failure path: the payment failed, so a resale listing goes back
    on sale and an original purchase's pending tickets are cancelled."""
    payment.status = PaymentStatus.FAILED
    payment.failure_reason = reason[:255]

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


def _after_success(payment: Payment, tickets: list[Ticket], transfer: Transfer | None) -> None:
    """Background work once a success is committed: mint the new tickets
    (or settle the resale), then email the receipt."""
    for ticket in tickets:
        mint_ticket_nft.delay(ticket.id)
    if transfer:
        settle_resale_transfer.delay(transfer.id)
    if (tickets or transfer) and settings.EMAIL_CONFIGURED:
        send_payment_receipt.delay(payment.id)


def _claim(db: Session, payment: Payment) -> bool:
    """Atomically take an INITIATED payment out of that state. The Paystack
    webhook and the checkout page's status poll can arrive at the same
    moment; only the one whose UPDATE matches gets to apply the outcome."""
    claimed = (
        db.query(Payment)
        .filter(Payment.id == payment.id, Payment.status == PaymentStatus.INITIATED)
        .update({Payment.status: PaymentStatus.SUCCESS}, synchronize_session=False)
    )
    return claimed == 1


def _settle_card_transaction(db: Session, payment: Payment, txn: dict) -> None:
    """Apply a verified Paystack transaction's outcome to its payment, at
    most once. Success, for the full amount in KES: the same success path as
    an M-Pesa receipt. Failed or reversed: failed. Anything else (abandoned,
    ongoing…): the buyer hasn't finished on Paystack's page, so no change."""
    outcome = txn.get("status")
    if outcome == "success" and (
        txn.get("currency") != "KES" or int(txn.get("amount") or 0) != paystack_service.amount_subunits(payment.amount_kes)
    ):
        logger.error(
            f"Paystack transaction {payment.id} succeeded for {txn.get('currency')} {txn.get('amount')} "
            f"but the order is KES {payment.amount_kes} — not applied; needs a manual check."
        )
        return
    paid = outcome == "success"
    failed = outcome in ("failed", "reversed")
    if not (paid or failed):
        return
    if not _claim(db, payment):
        db.rollback()
        db.refresh(payment)
        if paid and payment.status != PaymentStatus.SUCCESS:
            logger.error(
                f"Paystack says payment {payment.id} was paid, but it is already {payment.status.value} "
                f"— not applied; needs a manual refund check."
            )
        return

    if paid:
        details = paystack_service.card_details(txn)
        payment.provider_transaction_id = details["transaction_id"]
        payment.card_brand = details["card_brand"]
        payment.card_last4 = details["card_last4"]
        tickets, transfer = _handle_payment_success(db, payment, receipt_number=None)
        db.commit()
        logger.info(f"Card payment {payment.id} confirmed ({payment.paid_with}).")
        _after_success(payment, tickets, transfer)
    else:
        _handle_payment_failure(db, payment, txn.get("gateway_response") or "The card payment was declined.")
        db.commit()


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
    event = (
        db.query(Event)
        .filter(Event.id == body.event_id, Event.status == EventStatus.PUBLISHED, organiser_service.not_suspended())
        .first()
    )
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

    # Organiser Console tier rules: hidden/password tiers aren't on public
    # sale (they're handed out as complimentary tickets), and a tier can
    # have its own sales window and per-order limit.
    if (tier.visibility or "public") != "public":
        raise HTTPException(status_code=400, detail="This ticket tier isn't on public sale")
    now_naive = datetime.utcnow()
    if tier.sales_start and now_naive < tier.sales_start:
        raise HTTPException(status_code=400, detail="Sales for this ticket tier haven't opened yet")
    if tier.sales_end and now_naive > tier.sales_end:
        raise HTTPException(status_code=400, detail="Sales for this ticket tier have closed")
    if tier.per_order_max and body.quantity > tier.per_order_max:
        raise HTTPException(status_code=400, detail=f"You can buy at most {tier.per_order_max} tickets in this tier per order")

    if tier.tickets_remaining < body.quantity:
        raise HTTPException(status_code=400, detail="Not enough tickets remaining in this tier")

    total_amount = tier.price_kes * body.quantity
    if body.method == "card":
        if not settings.PAYSTACK_CONFIGURED:
            raise HTTPException(status_code=400, detail="Card payments aren't available yet. Pay with M-Pesa instead.")
        if not current_user.email:
            # Paystack sends its own card receipt, so it requires one.
            raise HTTPException(status_code=400, detail="Add an email address to your profile to pay by card.")

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

    # ── 3. Create one payment record covering the whole quantity ────────────
    payment = Payment(
        ticket_id=primary_ticket.id,
        tier_id=tier.id,
        user_id=current_user.id,
        amount_kes=total_amount,
        quantity=body.quantity,
        phone_number=body.phone_number or current_user.phone_number,
        method=body.method,
        status=PaymentStatus.INITIATED,
    )
    db.add(payment)
    db.flush()

    # Link the rest of the batch back to this payment (the primary ticket is
    # already linked via payment.ticket_id above).
    for ticket in tickets[1:]:
        ticket.group_payment_id = payment.id
    db.flush()

    # ── 4a. Card: open a Paystack Checkout page for the buyer ───────────────
    if body.method == "card":
        # Paystack sends the buyer back here either way; the checkout page
        # then polls /status (paid) or calls /cancel (pressed Cancel).
        back = f"{settings.SITE_URL.rstrip('/')}/checkout/{event.id}?tier={tier.id}&payment={payment.id}"
        try:
            txn = await run_in_threadpool(
                paystack_service.initialize_transaction,
                reference=payment.id,
                amount_kes=total_amount,
                email=current_user.email,
                description=f"{body.quantity} × {event.title} · {tier.tier_name}",
                callback_url=f"{back}&card=done",
                cancel_url=f"{back}&card=cancelled",
            )
        except PaystackError as e:
            db.rollback()
            raise HTTPException(status_code=502, detail=f"Card payment couldn't start: {e}")
        payment.provider_reference = txn.get("reference") or payment.id
        db.commit()
        return PurchaseResponse(
            ticket_id=primary_ticket.id,
            ticket_ids=[t.id for t in tickets],
            payment_id=payment.id,
            method="card",
            checkout_url=txn["authorization_url"],
            message="Continue to the secure card payment page.",
        )

    # ── 4. Send STK Push ─────────────────────────────────────────────────────
    try:
        daraja_response = await mpesa_service.stk_push(
            phone_number=body.phone_number,
            amount=int(total_amount),
            account_reference=primary_ticket.id[:12],
            transaction_desc=f"Ticket: {event.title[:13]}",
            callback_url=mpesa_service.stk_callback_url(payment.id),
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


async def _daraja_confirms(checkout_request_id: str) -> bool | None:
    """Ask Daraja (STK Push Query) whether this checkout was paid: True or
    False when it answers, None when it can't be asked right now."""
    try:
        answer = await mpesa_service.query_stk_status(checkout_request_id)
    except Exception as e:
        logger.warning(f"STK query for {checkout_request_id} failed: {e}")
        return None
    code = answer.get("ResultCode")
    if code is None:
        return None
    return str(code) == "0"


@router.post("/mpesa/callback/{payment_id}/{token}", include_in_schema=False)
async def mpesa_callback(payment_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    """
    Daraja posts an STK push's result here: each payment has its own URL
    with a secret token (mpesa_service.stk_callback_url), since Daraja
    callbacks aren't signed. A success is applied only when the checkout ID
    and amount match the payment and Daraja itself, asked directly, doesn't
    say otherwise. Always answers 200 so Daraja stops retrying.
    """
    if not hmac.compare_digest(mpesa_service.stk_callback_token(payment_id), token):
        raise HTTPException(status_code=403, detail="Invalid token")
    accepted = {"ResultCode": 0, "ResultDesc": "Accepted"}
    try:
        body = await request.json()
        logger.info(f"M-Pesa callback for payment {payment_id}: {body}")
        parsed = mpesa_service.parse_callback(body)

        payment = db.get(Payment, payment_id)
        if not payment or payment.method != "mpesa":
            logger.warning(f"M-Pesa callback for unknown payment {payment_id}")
            return accepted
        if parsed.get("checkout_request_id") != payment.checkout_request_id:
            logger.error(f"M-Pesa callback for payment {payment_id} names another checkout: {parsed.get('checkout_request_id')}")
            return accepted

        # Each payment is resolved exactly once. Daraja can deliver the same
        # callback twice, and a resale purchase that timed out has already
        # been released to other buyers — re-running success here would
        # double-count tickets or hand over a ticket that's no longer theirs.
        if payment.status != PaymentStatus.INITIATED:
            if parsed["success"]:
                logger.error(
                    f"M-Pesa success for payment {payment.id} that is already {payment.status.value} "
                    f"(receipt {parsed.get('receipt_number')}) — not applied; needs a manual refund check."
                )
            return accepted

        minted_tickets, paid_transfer = [], None
        if parsed["success"]:
            paid = float(parsed.get("amount") or 0)
            if int(round(paid)) != int(payment.amount_kes):
                logger.error(f"M-Pesa says KES {paid} paid for payment {payment.id} of KES {payment.amount_kes} — not applied")
                return accepted
            confirmed = await _daraja_confirms(payment.checkout_request_id)
            if confirmed is False:
                logger.error(f"Callback says payment {payment.id} was paid, but Daraja's STK query says not — not applied")
                return accepted
            if not _claim(db, payment):
                return accepted
            minted_tickets, paid_transfer = _handle_payment_success(db, payment, parsed["receipt_number"])
            logger.info(f"Payment {payment.id} confirmed. Receipt: {parsed['receipt_number']}"
                        f"{'' if confirmed else ' (STK query unavailable; callback URL token trusted)'}")
        else:
            if not _claim(db, payment):
                return accepted
            _handle_payment_failure(db, payment, parsed.get("result_desc") or "Unknown failure")
            logger.info(f"Payment failed for payment {payment.id}: {payment.failure_reason}")

        db.commit()
        _after_success(payment, minted_tickets, paid_transfer)
    except Exception as e:
        logger.error(f"Callback processing error: {e}", exc_info=True)
    return accepted


@router.post("/mpesa/callback", include_in_schema=False)
async def legacy_mpesa_callback(request: Request):
    """The old shared callback address, which anyone could post to. Nothing
    sent here is applied any more; payments use their own URLs above."""
    logger.warning("Ignored an M-Pesa callback sent to the old shared URL")
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/paystack/webhook", include_in_schema=False)
async def paystack_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Paystack POSTs card payment events here (Settings → API Keys & Webhooks
    in the Paystack dashboard). Unlike the M-Pesa callback, every request
    must carry a valid Paystack signature, so it can't be forged — and the
    transaction is verified with Paystack again before anything is applied.
    """
    payload = await request.body()
    try:
        event = paystack_service.verify_webhook(payload, request.headers.get("x-paystack-signature"))
    except ValueError as e:
        logger.warning(f"Rejected Paystack webhook: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event.get("event") == "charge.success":
        reference = (event.get("data") or {}).get("reference")
        payment = db.query(Payment).filter(Payment.provider_reference == reference).first() if reference else None
        if not payment:
            logger.warning(f"Paystack webhook for unknown reference {reference}")
        elif payment.status == PaymentStatus.INITIATED:
            try:
                txn = await run_in_threadpool(paystack_service.verify_transaction, reference)
            except PaystackError as e:
                # Not 200, so Paystack retries the webhook later.
                logger.warning(f"Couldn't verify Paystack transaction {reference}: {e}")
                raise HTTPException(status_code=502, detail="Couldn't verify the transaction")
            _settle_card_transaction(db, payment, txn)
    return {"received": True}


def _own_payment(db: Session, payment_id: str, user: User) -> Payment:
    payment = (
        db.query(Payment)
        .filter(Payment.id == payment_id, Payment.user_id == user.id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.get("/{payment_id}/status", response_model=PaymentStatusOut)
def get_payment_status(
    payment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Poll payment status — used by the frontend while waiting for M-Pesa
    confirmation, or after the buyer comes back from Paystack's card page."""
    payment = _own_payment(db, payment_id, current_user)
    if payment.method == "card" and payment.status == PaymentStatus.INITIATED and payment.provider_reference:
        # Ask Paystack rather than wait for the webhook, which may never come
        # (a laptop isn't reachable from Paystack) or come a little later.
        try:
            _settle_card_transaction(db, payment, paystack_service.verify_transaction(payment.provider_reference))
        except PaystackError as e:
            logger.warning(f"Couldn't check card payment {payment.id} with Paystack: {e}")
        db.refresh(payment)
    return payment


@router.post("/{payment_id}/cancel", response_model=PaymentStatusOut)
def cancel_card_payment(
    payment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The buyer pressed Cancel on Paystack's card page, which sends them
    back here: release the pending tickets. If they had in fact paid (e.g.
    in another tab), that wins and the payment succeeds. Paystack has no way
    to close a payment page, so a payment made on it after this is logged
    for a manual refund (see _settle_card_transaction)."""
    payment = _own_payment(db, payment_id, current_user)
    if payment.method != "card":
        raise HTTPException(status_code=400, detail="Only a card payment can be cancelled")
    if payment.status != PaymentStatus.INITIATED:
        return payment
    try:
        txn = paystack_service.verify_transaction(payment.provider_reference)
    except PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Couldn't reach Paystack to cancel: {e}")
    _settle_card_transaction(db, payment, txn)
    db.refresh(payment)
    if payment.status == PaymentStatus.INITIATED and _claim(db, payment):
        _handle_payment_failure(db, payment, "You cancelled the card payment.")
        db.commit()
        db.refresh(payment)
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
    if not settings.simulated_payments:
        raise HTTPException(status_code=404, detail="Not found")
    if not flag_on(db, "simulated_payments"):
        raise HTTPException(status_code=403, detail="Simulated payments are switched off. Complete the M-Pesa prompt instead.")

    payment = _own_payment(db, payment_id, current_user)
    if payment.method == "card":
        # Paystack's test mode already is the simulation: card 4084 0840 8408 4081.
        raise HTTPException(status_code=400, detail="This is a card payment. Finish it on Paystack's page instead.")
    if payment.status != PaymentStatus.INITIATED:
        raise HTTPException(status_code=400, detail=f"Payment already {payment.status.value}")

    tickets, transfer = _handle_payment_success(db, payment, receipt_number=f"DEV{payment.id[:8].upper()}")
    db.commit()
    db.refresh(payment)

    if tickets:
        logger.info(f"[DEV] Payment {payment.id} manually confirmed. {len(tickets)} ticket(s) activated.")
    elif transfer:
        logger.info(f"[DEV] Resale payment {payment.id} manually confirmed. Transfer {transfer.id} paid.")
    _after_success(payment, tickets, transfer)

    return payment
