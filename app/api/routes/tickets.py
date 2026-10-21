from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.models import Ticket, TicketStatus, User
from app.schemas.schemas import TicketOut, TicketSeedResponse
from app.services.totp_service import generate_qr_image_bytes, seconds_until_next_rotation, build_qr_payload
from app.core.dependencies import get_current_user
from app.core.config import get_settings

router = APIRouter(prefix="/tickets", tags=["Tickets"])
settings = get_settings()


@router.get("/my", response_model=List[TicketOut])
def get_my_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all tickets owned by the authenticated user."""
    return (
        db.query(Ticket)
        .filter(Ticket.owner_id == current_user.id)
        .order_by(Ticket.created_at.desc())
        .all()
    )


@router.get("/{ticket_id}/detail")
def get_ticket_detail(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Everything the Attendee frontend's Confirmation/TicketCredential pages
    need in one call — event/tier info, plus real on-chain mint status.
    chain_status flips pending -> verified once mint_ticket_nft actually
    completes (nft_token_id gets set); nft_tx_hash is the real transaction
    hash once it exists, not a placeholder — these pages poll this endpoint
    specifically to show that real transition happening.
    """
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    event = ticket.event
    return {
        "ticket_id": ticket.id,
        "event_id": ticket.event_id,
        "event_title": event.title if event else None,
        "category": event.category if event else None,
        "image_url": event.image_url if event else None,
        "venue": event.venue if event else None,
        "event_date": event.event_date if event else None,
        "tier_name": ticket.tier.tier_name if ticket.tier else None,
        "seat_number": ticket.seat_number,
        # No gate-scanner-assignment concept exists in this schema yet.
        "gate_assignment": None,
        "chain_status": "verified" if ticket.nft_token_id else "pending",
        "nft_token_id": ticket.nft_token_id,
        "nft_tx_hash": ticket.nft_tx_hash,
        # Self-custody (claimTicket) isn't wired into the backend yet —
        # always false/null here rather than faking a claim that never happened.
        "self_custodied": False,
        "wallet_address": None,
    }


@router.get("/{ticket_id}/seed", response_model=TicketSeedResponse)
def get_ticket_seed(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the TOTP secret seed for a ticket.
    This is called once by the ticket app on first load — the app
    stores the seed locally and generates QR codes offline from then on.

    Only the ticket owner can access this.
    """
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(
            status_code=400,
            detail=f"Ticket is not active (status: {ticket.status.value})"
        )

    event = ticket.event

    return TicketSeedResponse(
        ticket_id=ticket.id,
        totp_secret=ticket.totp_secret,
        totp_issuer=settings.TOTP_ISSUER,
        event_title=event.title,
        event_date=event.event_date.strftime("%d %b %Y, %H:%M"),
        venue=event.venue,
        qr_payload=build_qr_payload(ticket.id, ticket.totp_secret),
    )


@router.get("/{ticket_id}/qr.png")
def get_ticket_qr(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the current QR code as a PNG image.
    The client should refresh this every 30 seconds.

    Note: For production, QR generation happens on the client device using
    the stored seed. This endpoint is a fallback for web-based ticket viewing.
    """
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Ticket is not active")

    qr_bytes = generate_qr_image_bytes(ticket_id, ticket.totp_secret)
    ttl = seconds_until_next_rotation()

    return Response(
        content=qr_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": f"no-cache, max-age={ttl}",
            "X-QR-Expires-In": str(ttl),
        },
    )
