"""
Gate validation endpoints.
In production these run on the LOCAL mesh server at the venue,
not on the cloud backend.

The local server:
  1. Receives a pre-event sync of all active ticket secrets from the cloud
  2. Validates scans against its local DB (no internet needed)
  3. Marks tickets as USED immediately and broadcasts to all scanner apps

Scanner device registration/enrolment (Work Order 04 B4): an organiser
registers a device for one event+gate and gets a one-time enrolment code;
the physical device submits that code once and gets a long-lived device
token back. Sync (and, eventually, scan-upload) authenticate with that
token, not a user JWT — a steward shouldn't need to be a user account, and
a phone at a gate shouldn't carry credentials that work anywhere else.
"""
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Ticket, TicketStatus, Event, GateScanner, GateScannerStatus, AuditLog, User, OrganizerRole
from app.core.dependencies import get_current_user
from app.core.authz import check_org_role, get_current_scanner, hash_token, generate_token
from app.schemas.schemas import (
    ScannerRegisterRequest, ScannerRegisterResponse, ScannerEnrollRequest, ScannerEnrollResponse,
)

router = APIRouter(prefix="/gate", tags=["Gate Validation"])

_ENROLLMENT_CODE_TTL_MINUTES = 15


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
    Unchanged by Work Order 04 — this is the public cloud endpoint, no
    auth by design, untouched so the existing attendee journey keeps
    working exactly as before.
    """
    # ── 1. Parse QR payload ──────────────────────────────────────────────────
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
    ticket.used_at = datetime.now(timezone.utc)
    db.commit()

    return ScanResult(
        valid=True,
        ticket_id=ticket_id,
        event_title=ticket.event.title,
        owner_phone=ticket.owner.phone_number[-4:].rjust(len(ticket.owner.phone_number), "*"),
        scanned_at=ticket.used_at.strftime("%H:%M:%S"),
    )


# ─── Scanner device registration / enrolment (Work Order 04 B4) ────────────

@router.post("/scanners", response_model=ScannerRegisterResponse, status_code=201)
def register_scanner(
    body: ScannerRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    An organiser (owner or staff) registers intent for a device at one of
    their events' gates and gets back a one-time enrolment code — no
    physical device is involved yet, so device_id/device_token stay null
    until /gate/enroll is called.

    event_id comes from the request body, not the path, so this can't use
    require_event_org_role as a Depends (FastAPI would read it as a query
    parameter instead) — resolves the event and checks membership directly,
    the same shared primitive that dependency wraps.
    """
    event = db.query(Event).filter(Event.id == body.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.organizer_id:
        raise HTTPException(status_code=403, detail="This event has no organisation and cannot be managed")
    check_org_role(db, current_user.id, event.organizer_id, OrganizerRole.STAFF)

    code = secrets.token_hex(4).upper()  # short, human-typeable
    scanner = GateScanner(
        event_id=event.id,
        organizer_id=event.organizer_id,
        gate_name=body.gate_name,
        enrollment_code=code,
        # Naive UTC deliberately — SQLite round-trips DateTime columns as
        # naive, and comparing that against an aware "now" raises (same
        # reasoning as resale.py's _eligible_ticket/_compute_wallet).
        enrollment_code_expires_at=datetime.utcnow() + timedelta(minutes=_ENROLLMENT_CODE_TTL_MINUTES),
        status=GateScannerStatus.INACTIVE,
    )
    db.add(scanner)
    db.commit()
    db.refresh(scanner)

    return ScannerRegisterResponse(
        scanner_id=scanner.id,
        enrollment_code=code,
        expires_at=scanner.enrollment_code_expires_at,
    )


@router.post("/enroll", response_model=ScannerEnrollResponse)
def enroll_scanner(body: ScannerEnrollRequest, db: Session = Depends(get_db)):
    """
    The device itself submits the enrolment code once (no user auth — the
    device isn't a user account) and gets a long-lived device token back.
    Single-use: the code is cleared on success.
    """
    scanner = db.query(GateScanner).filter(GateScanner.enrollment_code == body.enrollment_code).first()
    if not scanner:
        raise HTTPException(status_code=404, detail="Invalid enrolment code")
    if not scanner.enrollment_code_expires_at or scanner.enrollment_code_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Enrolment code has expired")

    existing_device = db.query(GateScanner).filter(GateScanner.device_id == body.device_id).first()
    if existing_device and existing_device.id != scanner.id:
        raise HTTPException(status_code=409, detail="This device is already enrolled for a different gate")

    event = db.query(Event).filter(Event.id == scanner.event_id).first()

    token = generate_token()
    scanner.device_id = body.device_id
    scanner.device_token_hash = hash_token(token)
    scanner.enrollment_code = None
    scanner.enrollment_code_expires_at = None
    scanner.status = GateScannerStatus.ACTIVE
    db.commit()
    db.refresh(scanner)

    return ScannerEnrollResponse(
        device_token=token,
        scanner_id=scanner.id,
        event_id=scanner.event_id,
        event_title=event.title if event else "",
        gate_name=scanner.gate_name,
    )


@router.post("/scanners/{scanner_id}/revoke", status_code=204)
def revoke_scanner(
    scanner_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke a device — immediately invalidates its token (get_current_scanner
    requires ACTIVE status on every request)."""
    scanner = db.query(GateScanner).filter(GateScanner.id == scanner_id).first()
    if not scanner:
        raise HTTPException(status_code=404, detail="Scanner not found")

    check_org_role(db, current_user.id, scanner.organizer_id, OrganizerRole.STAFF)

    scanner.status = GateScannerStatus.INACTIVE
    db.commit()


# ─── Pre-event sync (Work Order 03, re-authenticated in Work Order 04 B4) ──

@router.get("/sync-event/{event_id}")
def sync_event_tickets(
    event_id: str,
    scanner: GateScanner = Depends(get_current_scanner),
    db: Session = Depends(get_db),
):
    """
    Pre-event sync endpoint. A scanning device calls this once before doors
    open to download every active ticket's TOTP secret for fully offline
    validation — see docs/offline-validation.md.

    Authenticates with the device's own long-lived token (Work Order 04
    B4), not a user JWT — replacing Work Order 03's "the event's creator"
    check now that a real device identity exists. The path's event_id must
    match the event this device was enrolled for; a device cannot sync any
    event other than the one it's bound to, which is the gate-partitioning
    this endpoint can offer today (full per-ticket gate assignment is a
    larger feature, not built here).
    """
    if scanner.event_id != event_id:
        raise HTTPException(status_code=403, detail="This device is not enrolled for this event")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    now = datetime.now(timezone.utc)
    scanner.last_sync_at = now

    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.event_id == event_id,
            Ticket.status == TicketStatus.ACTIVE,
        )
        .all()
    )

    db.add(AuditLog(
        actor_id=scanner.account_id,
        action_type="gate_sync",
        target_id=event_id,
        target_type="event",
    ))
    db.commit()

    return {
        "event_id": event_id,
        "event_title": event.title,
        "event_date": event.event_date.isoformat(),
        "gate_name": scanner.gate_name,
        "scanner_id": scanner.id,
        "device_id": scanner.device_id,
        "synced_at": now.isoformat(),
        "ticket_count": len(tickets),
        "tickets": [
            {
                "id": t.id,
                "tier_name": t.tier.tier_name if t.tier else None,
                "seat_number": t.seat_number,
                "gate_assignment": None,
                "totp_secret": t.totp_secret,
                "status": t.status.value,
            }
            for t in tickets
        ],
    }
