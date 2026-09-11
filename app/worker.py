"""
Celery worker configuration.

Phase 1: Worker is defined but tasks are stubs.
Phase 2: NFT minting tasks will run here asynchronously after M-Pesa confirmation,
         so the HTTP callback returns instantly without waiting for blockchain tx.

Start worker:
    celery -A app.worker worker --loglevel=info
"""
from celery import Celery
from app.core.config import get_settings

settings = get_settings()

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
        "app.worker.send_ticket_confirmation_sms": {"queue": "notifications"},
    },
)


# ── Phase 2 Stub: NFT Minting ─────────────────────────────────────────────────

@celery_app.task(
    name="app.worker.mint_ticket_nft",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def mint_ticket_nft(self, ticket_id: str, event_id: str, owner_wallet: str):
    """
    Mint an NFT for the given ticket after successful M-Pesa payment.

    Phase 2 implementation will:
      1. Load the event's smart contract via web3.py
      2. Call contract.mint(owner_wallet, ticket_id)
      3. Wait for transaction confirmation
      4. Update ticket.nft_token_id and ticket.nft_tx_hash in the DB

    For now: logs the intent and returns.
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(
        f"[STUB] Would mint NFT for ticket={ticket_id}, "
        f"event={event_id}, wallet={owner_wallet}"
    )
    # Phase 2: replace stub with web3.py minting logic
    return {"status": "stub", "ticket_id": ticket_id}


# ── Notification Task ─────────────────────────────────────────────────────────

@celery_app.task(name="app.worker.send_ticket_confirmation_sms")
def send_ticket_confirmation_sms(phone_number: str, ticket_id: str, event_title: str):
    """
    Send SMS confirmation after ticket activation.
    Uses Africa's Talking API.
    """
    import logging
    logger = logging.getLogger(__name__)

    message = (
        f"Your TiketiKE ticket for {event_title} is confirmed! "
        f"Ticket ID: {ticket_id[:8].upper()}. "
        f"Open the app to view your QR code."
    )

    if settings.APP_ENV == "development":
        logger.info(f"[DEV SMS] To {phone_number}: {message}")
        return

    try:
        import africastalking
        africastalking.initialize(settings.AFRICASTALKING_USERNAME, settings.AFRICASTALKING_API_KEY)
        africastalking.SMS.send(
            message=message,
            recipients=[f"+{phone_number}"],
            sender_id="TIKETI",
        )
    except Exception as exc:
        logger.error(f"SMS failed for {phone_number}: {exc}")
        raise
