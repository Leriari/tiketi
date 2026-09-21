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
