"""
Celery worker configuration.

mint_ticket_nft runs asynchronously after M-Pesa confirmation, so the HTTP
callback returns instantly without waiting for a blockchain transaction.

Start worker:
    celery -A app.worker worker --loglevel=info
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
        royalty_bps = int(round(tier.organizer_royalty_percent * 100))

        try:
            token_id, tx_hash = web3_service.mint_ticket_onchain(
                event_id=ticket.event_id,
                tier_id=ticket.tier_id,
                face_price_kes=int(tier.price_kes),
                resale_cap_bps=resale_cap_bps,
                royalty_bps=royalty_bps,
            )
        except Exception as exc:
            logger.error(f"mint_ticket_nft failed for ticket={ticket_id}: {exc}")
            raise self.retry(exc=exc)

        ticket.nft_token_id = token_id
        ticket.nft_tx_hash = tx_hash
        db.commit()

        logger.info(f"Minted NFT for ticket={ticket_id}: token_id={token_id} tx={tx_hash}")
        return {"status": "minted", "ticket_id": ticket_id, "token_id": token_id, "tx_hash": tx_hash}
    finally:
        db.close()
