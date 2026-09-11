"""
Gate validation endpoints.
In production these run on the LOCAL mesh server at the venue,
not on the cloud backend.

The local server:
  1. Receives a pre-event sync of all active ticket secrets from the cloud
  2. Validates scans against its local DB (no internet needed)
  3. Marks tickets as USED immediately and broadcasts to all scanner apps
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Ticket, TicketStatus
from app.services.totp_service import validate_scanned_payload

router = APIRouter(prefix="/gate", tags=["Gate Validation"])


class ScanRequest(BaseModel):
    qr_payload: str    # Raw string decoded from QR scan
    scanner_id: str    # Bouncer device ID


class ScanResult(BaseModel):
    valid: bool
    ticket_id: str | None = None
    event_title: str | None = None
    owner_phone: str | None = None
    reason: str | None = None
    scanned_at: str | None = None


@router.post("/scan", response_model=ScanResult)
def scan_ticket(body: ScanRequest, db: Session = Depends(get_db)):
    """
    Validate a scanned QR code.
    Returns a clear VALID / INVALID result for the bouncer app to display.
    """
    # ── 1. Parse and validate QR payload ────────────────────────────────────
    is_valid, result = validate_scanned_payload(body.qr_payload, secret="")

    # Extract ticket_id from payload to look up the secret
    parts = body.qr_payload.split(":")
    if len(parts) != 3 or parts[0] != "TIKETI":
        return ScanResult(valid=False, reason="Invalid QR format")

    ticket_id = parts[1]
    scanned_otp = parts[2]

    # ── 2. Look up ticket in local DB ────────────────────────────────────────
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        return ScanResult(valid=False, ticket_id=ticket_id, reason="Ticket not found")

    # ── 3. Validate OTP using the ticket's stored secret ─────────────────────
    from app.services.totp_service import verify_otp as totp_verify
    if not totp_verify(ticket.totp_secret, scanned_otp):
        return ScanResult(valid=False, ticket_id=ticket_id, reason="QR code expired or invalid")

    # ── 4. Check ticket status ───────────────────────────────────────────────
    if ticket.status == TicketStatus.USED:
        return ScanResult(
            valid=False,
            ticket_id=ticket_id,
            reason=f"Already used at {ticket.used_at.strftime('%H:%M:%S') if ticket.used_at else 'unknown time'}",
        )

    if ticket.status != TicketStatus.ACTIVE:
        return ScanResult(
            valid=False,
            ticket_id=ticket_id,
            reason=f"Ticket status: {ticket.status.value}",
        )

    # ── 5. Mark as USED ──────────────────────────────────────────────────────
    ticket.status = TicketStatus.USED
    ticket.used_at = datetime.utcnow()
    db.commit()

    return ScanResult(
        valid=True,
        ticket_id=ticket_id,
        event_title=ticket.event.title,
        owner_phone=ticket.owner.phone_number[-4:].rjust(len(ticket.owner.phone_number), "*"),
        scanned_at=ticket.used_at.strftime("%H:%M:%S"),
    )


@router.get("/sync-event/{event_id}")
def sync_event_tickets(event_id: str, db: Session = Depends(get_db)):
    """
    Pre-event sync endpoint.
    The local mesh server calls this once before the event starts
    to download all active ticket IDs + TOTP secrets for offline validation.

    In production: this endpoint requires a special sync key and
    is only callable from the local server's IP.
    """
    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.event_id == event_id,
            Ticket.status == TicketStatus.ACTIVE,
        )
        .all()
    )

    # Return minimal data — only what the gate needs
    return {
        "event_id": event_id,
        "ticket_count": len(tickets),
        "tickets": [
            {"id": t.id, "totp_secret": t.totp_secret}
            for t in tickets
        ],
        "synced_at": datetime.utcnow().isoformat(),
    }
