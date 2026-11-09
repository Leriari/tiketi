"""
Celery worker configuration.

mint_ticket_nft runs asynchronously after M-Pesa confirmation, so the HTTP
callback returns instantly without waiting for a blockchain transaction.

Start worker:
    celery -A app.worker worker --loglevel=info -Q celery,blockchain

The -Q flag matters: mint_ticket_nft is routed to the "blockchain" queue
(see task_routes below), and a worker started without -Q blockchain will
never consume it — the task just sits in Redis, silently unprocessed.
"""
import logging
from celery import Celery
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

celery_app = Celery(
    "tiketi",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Nairobi",
    enable_utc=True,
    task_routes={
        "app.worker.mint_ticket_nft": {"queue": "blockchain"},
        "app.worker.settle_resale_transfer": {"queue": "blockchain"},
        "app.worker.mark_ticket_used_onchain": {"queue": "blockchain"},
    },
)


# ── NFT Minting ────────────────────────────────────────────────────────────

@celery_app.task(
    name="app.worker.mint_ticket_nft",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def mint_ticket_nft(self, ticket_id: str):
    """
    Mint an NFT for the given ticket after successful M-Pesa payment.

    Mints to the platform's own custodial wallet (see
    app/services/web3_service.py for why) and writes the resulting
    nft_token_id/nft_tx_hash back onto the Ticket row.

    A no-op (logs and returns) if BLOCKCHAIN_RPC_URL / NFT_CONTRACT_ADDRESS /
    MINTER_PRIVATE_KEY aren't all set — this task is additive, not
    load-bearing, so an unconfigured deployment doesn't retry forever.
    Real on-chain failures use Celery's own retry policy above.
    """
    # Imported inside the task (not at module import time) so this module can
    # still be imported — and the worker can still start — even in an
    # environment where app.db.session's DB isn't reachable yet.
    from app.db.session import SessionLocal
    from app.models.models import Ticket
    from app.services import web3_service

    if not settings.BLOCKCHAIN_CONFIGURED:
        logger.info(f"[SKIP] Blockchain not configured — ticket={ticket_id} stays un-minted.")
        return {"status": "skipped", "reason": "not_configured", "ticket_id": ticket_id}

    db = SessionLocal()
    try:
        ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not ticket:
            logger.error(f"mint_ticket_nft: ticket {ticket_id} not found")
            return {"status": "error", "reason": "ticket_not_found", "ticket_id": ticket_id}

        tier = ticket.tier
        if not tier:
            logger.error(f"mint_ticket_nft: ticket {ticket_id} has no tier — cannot compute resale cap/royalty")
            return {"status": "error", "reason": "no_tier", "ticket_id": ticket_id}

        resale_cap_bps = (
            int(round((tier.resale_ceiling_price_kes / tier.price_kes) * 10000))
            if tier.price_kes
            else 10000  # no price to compute a ratio against — default to "no markup allowed"
        )
        # The organiser's lowest allowed resale price, as a share of face
        # value; never above the cap (the contract refuses that).
        resale_floor_bps = (
            min(int(round((tier.resale_floor_price_kes or 0) / tier.price_kes * 10000)), resale_cap_bps)
            if tier.price_kes
            else 0
        )
        royalty_bps = int(round(tier.organizer_royalty_percent * 100))

        try:
            token_id, tx_hash = web3_service.mint_ticket_onchain(
                event_id=ticket.event_id,
                tier_id=ticket.tier_id,
                face_price_kes=int(tier.price_kes),
                resale_floor_bps=resale_floor_bps,
                resale_cap_bps=resale_cap_bps,
                royalty_bps=royalty_bps,
            )
        except Exception as exc:
            logger.error(f"mint_ticket_nft failed for ticket={ticket_id}: {exc}")
            raise self.retry(exc=exc)

        ticket.nft_token_id = token_id
        ticket.nft_tx_hash = tx_hash
        ticket.nft_contract_address = settings.NFT_CONTRACT_ADDRESS
        # The limits as the contract computes them (cap rounded down, floor up).
        face = int(tier.price_kes)
        ticket.onchain_face_kes = face
        ticket.onchain_cap_kes = face * resale_cap_bps // 10000
        ticket.onchain_floor_kes = -(-face * resale_floor_bps // 10000)
        db.commit()

        logger.info(f"Minted NFT for ticket={ticket_id}: token_id={token_id} tx={tx_hash}")
        return {"status": "minted", "ticket_id": ticket_id, "token_id": token_id, "tx_hash": tx_hash}
    finally:
        db.close()


# ── Resale settlement (Work Order 02) ──────────────────────────────────────

@celery_app.task(
    name="app.worker.settle_resale_transfer",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def settle_resale_transfer(self, transfer_id: str):
    """
    Complete a resale after its M-Pesa payment succeeds: settle the listing
    on-chain (settleCustodialResale — a real transaction, the on-chain
    evidence that this sale happened, per Work Order 02), move ticket
    ownership in the database, rotate the ticket's TOTP credential (the
    seller's old QR must stop working — this is the exact fraud a working
    resale system exists to prevent), and record the seller's payout.

    A no-op (logs and returns) if blockchain isn't configured, same
    reasoning as mint_ticket_nft. A real on-chain failure marks the transfer
    settlement_failed and retries via Celery's own policy above — the
    seller has been paid, so this must never silently disappear.
    """
    from datetime import datetime, timezone, timedelta
    from app.db.session import SessionLocal
    from app.models.models import (
        Transfer, TransferStatus, TicketStatus, Barcode, BarcodeStatus,
        WalletTransaction, WalletTransactionType,
    )
    from app.services import web3_service
    from app.services.totp_service import generate_totp_secret
    from app.core.crypto import encrypt_secret
    from app.services.platform_settings import current_fees

    if not settings.BLOCKCHAIN_CONFIGURED:
        logger.info(f"[SKIP] Blockchain not configured — transfer={transfer_id} stays unsettled.")
        return {"status": "skipped", "reason": "not_configured", "transfer_id": transfer_id}

    db = SessionLocal()
    try:
        transfer = db.query(Transfer).filter(Transfer.id == transfer_id).first()
        if not transfer:
            logger.error(f"settle_resale_transfer: transfer {transfer_id} not found")
            return {"status": "error", "reason": "transfer_not_found", "transfer_id": transfer_id}

        ticket = transfer.ticket
        if not ticket or not ticket.nft_token_id:
            logger.error(f"settle_resale_transfer: ticket for transfer {transfer_id} has no nft_token_id")
            transfer.status = TransferStatus.SETTLEMENT_FAILED
            db.commit()
            return {"status": "error", "reason": "no_nft_token", "transfer_id": transfer_id}

        try:
            tx_hash = web3_service.settle_custodial_resale_onchain(ticket.nft_token_id, web3_service.ticket_contract_address(ticket))
        except Exception as exc:
            logger.error(f"settle_resale_transfer failed for transfer={transfer_id}: {exc}")
            transfer.status = TransferStatus.SETTLEMENT_FAILED
            db.commit()
            raise self.retry(exc=exc)

        # ── Freeze the financial record ──────────────────────────────────
        tier = ticket.tier
        royalty_percent = tier.organizer_royalty_percent if tier else 0.0
        price = transfer.asking_price_kes
        fees = current_fees(db)  # the rates in force when the sale settles
        royalty_kes = round(price * royalty_percent / 100)
        platform_fee_kes = round(price * fees.platform_fee_percent / 100)
        payout_kes = price - royalty_kes - platform_fee_kes

        transfer.status = TransferStatus.COMPLETED
        transfer.settlement_tx_hash = tx_hash
        transfer.transfer_price_kes = price
        transfer.organizer_royalty_kes = royalty_kes
        transfer.platform_fee_kes = platform_fee_kes
        transfer.seller_payout_kes = payout_kes
        transfer.transferred_at = datetime.now(timezone.utc)

        # ── Move ownership off-chain ──────────────────────────────────────
        seller_id = ticket.owner_id
        ticket.owner_id = transfer.buyer_id
        ticket.status = TicketStatus.ACTIVE

        # ── Rotate the credential ──────────────────────────────────────────
        for old_barcode in ticket.barcodes:
            if old_barcode.status == BarcodeStatus.ACTIVE:
                old_barcode.status = BarcodeStatus.REVOKED
        latest_version = max((b.token_version for b in ticket.barcodes), default=0)
        db.add(Barcode(
            ticket_id=ticket.id,
            event_id=ticket.event_id,
            owner_id=transfer.buyer_id,
            token=encrypt_secret(generate_totp_secret()),
            token_version=latest_version + 1,
            status=BarcodeStatus.ACTIVE,
        ))

        # ── Record the seller's payout ─────────────────────────────────────
        event = transfer.event
        available_at = (
            event.event_date + timedelta(days=fees.seller_escrow_days) if event else datetime.now(timezone.utc)
        )
        db.add(WalletTransaction(
            user_id=seller_id,
            transfer_id=transfer.id,
            type=WalletTransactionType.SALE,
            description=f"Resale · {event.title if event else 'ticket'}",
            amount_kes=payout_kes,
            available_at=available_at,
        ))

        db.commit()
        logger.info(f"Settled resale transfer={transfer_id}: tx={tx_hash}, new owner={transfer.buyer_id}")
        return {"status": "completed", "transfer_id": transfer_id, "tx_hash": tx_hash}
    finally:
        db.close()


# ── Admission on-chain ──────────────────────────────────────────────────────

@celery_app.task(
    name="app.worker.mark_ticket_used_onchain",
    bind=True,
    max_retries=10,
    default_retry_delay=60,
)
def mark_ticket_used_onchain(self, ticket_id: str):
    """
    Record an admission on-chain (TiketiNFT.markUsed), after the gate has
    already let the person in — the gate never waits for a chain. Queued by
    every admission path (console scan, manual override, offline upload —
    the last doesn't change Ticket.status). Retries while the mint is in flight.
    """
    from app.db.session import SessionLocal
    from app.models.models import Ticket
    from app.services import web3_service

    if not settings.BLOCKCHAIN_CONFIGURED:
        return {"status": "skipped", "reason": "not_configured", "ticket_id": ticket_id}

    db = SessionLocal()
    try:
        ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not ticket or ticket.used_tx_hash:
            return {"status": "skipped", "ticket_id": ticket_id}
        if not ticket.nft_token_id:
            raise self.retry()  # not minted yet
        try:
            tx_hash = web3_service.mark_used_onchain(ticket.nft_token_id, web3_service.ticket_contract_address(ticket))
        except web3_service.ContractRevertError as exc:
            if "already used" in str(exc):
                return {"status": "already_used", "ticket_id": ticket_id}
            raise
        except Exception as exc:
            logger.error(f"mark_ticket_used_onchain failed for ticket={ticket_id}: {exc}")
            raise self.retry(exc=exc)
        ticket.used_tx_hash = tx_hash
        db.commit()
        return {"status": "marked", "ticket_id": ticket_id, "tx_hash": tx_hash}
    finally:
        db.close()


# ── Email ───────────────────────────────────────────────────────────────────

def _already_sent(db, reference: str, kind: str) -> bool:
    from app.models.models import Notification, NotificationStatus
    return db.query(Notification.id).filter(
        Notification.reference == reference, Notification.notification_type == kind,
        Notification.status == NotificationStatus.SENT,
    ).first() is not None


def _deliver(task, db, *, user, kind: str, reference: str, subject: str, text: str, body: str):
    """Send one email and record it; retries the task on SMTP failure."""
    from datetime import datetime as _dt
    from app.models.models import Notification, NotificationStatus
    from app.services import email_service

    try:
        email_service.send_email(user.email, subject, text, body)
    except Exception as exc:
        if task.request.retries >= task.max_retries:
            db.add(Notification(recipient_id=user.id, notification_type=kind, channel="email",
                                status=NotificationStatus.FAILED, reference=reference))
            db.commit()
        logger.error(f"{kind} email for {reference} failed: {exc}")
        raise task.retry(exc=exc)
    db.add(Notification(recipient_id=user.id, notification_type=kind, channel="email",
                        status=NotificationStatus.SENT, sent_at=_dt.utcnow(), reference=reference))
    db.commit()


def _local_phone(phone: str | None) -> str:
    return "0" + phone[3:] if phone and phone.startswith("254") else (phone or "")


@celery_app.task(name="app.worker.send_payment_receipt", bind=True, max_retries=5, default_retry_delay=120)
def send_payment_receipt(self, payment_id: str, force: bool = False):
    """Email the buyer a receipt for a confirmed payment — a primary
    purchase or a resale one. Once per payment unless forced (the buyer
    asking for it again)."""
    from app.db.session import SessionLocal
    from app.models.models import Payment, PaymentStatus, Ticket, Transfer
    from app.services import email_service

    if not settings.EMAIL_CONFIGURED:
        return {"status": "skipped", "reason": "email_not_configured"}
    db = SessionLocal()
    try:
        payment = db.query(Payment).filter(Payment.id == payment_id).first()
        if not payment or payment.status != PaymentStatus.SUCCESS:
            return {"status": "skipped", "reason": "not_paid"}
        user = payment.user
        if not user or not user.email:
            return {"status": "skipped", "reason": "no_email"}
        if not force and _already_sent(db, payment.id, "payment_receipt"):
            return {"status": "skipped", "reason": "already_sent"}

        transfer = db.query(Transfer).filter(Transfer.payment_id == payment.id).first()
        ticket = transfer.ticket if transfer else db.query(Ticket).filter(Ticket.id == payment.ticket_id).first()
        event = ticket.event if ticket else None
        tier = payment.tier or (ticket.tier if ticket else None)
        subject, text, body = email_service.purchase_receipt(
            name=user.display_name,
            order_ref=payment.id[:8].upper(),
            event_title=event.title if event else "your event",
            event_date=event.event_date if event else None,
            venue=event.venue if event else "",
            tier_name=tier.tier_name if tier else "General",
            quantity=1 if transfer else (payment.quantity or 1),
            amount_kes=payment.amount_kes,
            mpesa_receipt=payment.mpesa_receipt_number,
            card=payment.paid_with if payment.method == "card" else None,
            paid_at=payment.confirmed_at,
            phone=_local_phone(payment.phone_number or user.phone_number),
            resale=bool(transfer),
            tickets_url=f"{settings.SITE_URL.rstrip('/')}/tickets",
        )
        _deliver(self, db, user=user, kind="payment_receipt", reference=payment.id, subject=subject, text=text, body=body)
        return {"status": "sent", "payment_id": payment_id}
    finally:
        db.close()


@celery_app.task(name="app.worker.send_transfer_notice", bind=True, max_retries=5, default_retry_delay=120)
def send_transfer_notice(self, audit_log_id: str):
    """Tell the recipient of a gifted ticket that it's in their account.
    audit_log_id: the ticket_transferred entry (app/api/routes/tickets.py)."""
    from app.db.session import SessionLocal
    from app.models.models import AuditLog, Ticket, User
    from app.services import email_service

    if not settings.EMAIL_CONFIGURED:
        return {"status": "skipped", "reason": "email_not_configured"}
    db = SessionLocal()
    try:
        log = db.query(AuditLog).filter(AuditLog.id == audit_log_id, AuditLog.action_type == "ticket_transferred").first()
        if not log or not (log.details or "").startswith("to="):
            return {"status": "skipped", "reason": "not_found"}
        recipient = db.query(User).filter(User.id == log.details[3:]).first()
        sender = db.query(User).filter(User.id == log.actor_id).first()
        ticket = db.query(Ticket).filter(Ticket.id == log.target_id).first()
        if not recipient or not recipient.email or not ticket:
            return {"status": "skipped", "reason": "no_email"}
        if _already_sent(db, log.id, "ticket_transfer"):
            return {"status": "skipped", "reason": "already_sent"}
        event = ticket.event
        subject, text, body = email_service.transfer_notice(
            recipient_name=recipient.display_name,
            sender_name=(sender.display_name if sender and sender.display_name else "A ChainTix user"),
            event_title=event.title, event_date=event.event_date, venue=event.venue,
            tier_name=ticket.tier.tier_name if ticket.tier else "General",
            tickets_url=f"{settings.SITE_URL.rstrip('/')}/tickets",
        )
        _deliver(self, db, user=recipient, kind="ticket_transfer", reference=log.id, subject=subject, text=text, body=body)
        return {"status": "sent", "audit_log_id": audit_log_id}
    finally:
        db.close()
