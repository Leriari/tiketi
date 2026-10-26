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
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import (
    Ticket, TicketStatus, Event, GateScanner, GateScannerStatus, AuditLog, User, OrganizerRole,
    Attendance, AttendanceStatus,
)
from app.core.dependencies import get_current_user
from app.core.authz import check_org_role, get_current_scanner, hash_token, generate_token
from app.core.config import get_settings
from app.services.gate_partitioning import assign_gate
from app.worker import mark_ticket_used_onchain
from app.schemas.schemas import (
    ScannerRegisterRequest, ScannerRegisterResponse, ScannerEnrollRequest, ScannerEnrollResponse,
    ScanUploadRequest, ScanUploadResultItem,
)

router = APIRouter(prefix="/gate", tags=["Gate Validation"])
settings = get_settings()

_ENROLLMENT_CODE_TTL_MINUTES = 15


# Scanning: there is deliberately no public "mark this ticket used" endpoint.
# Staff scan online from the Organiser Console (POST /organisations/{org}/
# events/{event}/scan — signed in, checked against the event, recorded as
# attendance); enrolled devices validate offline and report through
# /gate/scan-upload (device token).


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

    # Registering a device at a gate the event doesn't list yet adds that
    # gate, so the event's gate list (Event Management, Crowd Control)
    # always covers every gate tickets are partitioned over.
    gate_name = body.gate_name.strip()
    if not gate_name:
        raise HTTPException(status_code=400, detail="A gate name is required")
    if gate_name not in [g.get("name") for g in (event.gates or [])]:
        event.gates = [*(event.gates or []), {"id": str(uuid.uuid4()), "name": gate_name}]

    code = secrets.token_hex(4).upper()  # short, human-typeable
    scanner = GateScanner(
        event_id=event.id,
        organizer_id=event.organizer_id,
        gate_name=gate_name,
        label=(body.label or "").strip() or None,
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
    # A device revoked before it enrolled must not be able to enrol later
    # with the code it was already given.
    scanner.enrollment_code = None
    scanner.enrollment_code_expires_at = None
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
    open to download its own gate's TOTP secrets for fully offline
    validation — see docs/offline-validation.md.

    Authenticates with the device's own long-lived token (Work Order 04
    B4), not a user JWT. The path's event_id must match the event this
    device was enrolled for.

    Gate partitioning (Work Order 05 B1): each ticket is deterministically
    assigned to exactly one of the event's currently-registered gates (a
    stable hash of ticket_id, modulo the sorted gate list —
    app/services/gate_partitioning.py) — this device only receives the
    tickets assigned to *its own* gate, so two offline gates can no longer
    both admit the same ticket. See that module's docstring for the one
    real limitation: the assignment reshuffles if the event's gate set
    changes after a device has already synced.
    """
    if scanner.event_id != event_id:
        raise HTTPException(status_code=403, detail="This device is not enrolled for this event")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    now = datetime.now(timezone.utc)
    scanner.last_sync_at = now

    gate_names = sorted({
        name for (name,) in db.query(GateScanner.gate_name)
        .filter(GateScanner.event_id == event_id, GateScanner.status == GateScannerStatus.ACTIVE)
        .distinct()
    })

    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.event_id == event_id,
            Ticket.status == TicketStatus.ACTIVE,
        )
        .all()
    )
    my_tickets = [t for t in tickets if assign_gate(t.id, gate_names) == scanner.gate_name]

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
        "ticket_count": len(my_tickets),
        "tickets": [
            {
                "id": t.id,
                "tier_name": t.tier.tier_name if t.tier else None,
                "seat_number": t.seat_number,
                "gate_assignment": scanner.gate_name,
                "totp_secret": t.totp_secret,
                "status": t.status.value,
            }
            for t in my_tickets
        ],
    }


# ─── Scan reconciliation (Work Order 05 B5) ─────────────────────────────────

@router.post("/scan-upload", response_model=list[ScanUploadResultItem])
def upload_scan_batch(
    body: ScanUploadRequest,
    scanner: GateScanner = Depends(get_current_scanner),
    db: Session = Depends(get_db),
):
    """
    Uploads a batch of offline scan decisions once connectivity returns,
    writing real Attendance rows (Work Order 05 B2's denial_reason makes
    this a real breakdown by failure type, not just a count).

    Idempotent by ticket_id, not by upload call: a phone retrying an
    upload must not create duplicate Attendance rows. An ADMITTED scan is
    idempotent only against *this same scanner* re-uploading the same
    ticket — if a *different* scanner already admitted this ticket (two
    gates offline at once, see gate_partitioning.py's limitation, or a
    gate mis-assignment), that is reported back as a conflict, not
    silently resolved or overwritten. A DENIED scan is deduplicated
    against an identical prior row from the same scanner.
    """
    results: list[ScanUploadResultItem] = []
    admitted: list[str] = []
    ids = {item.ticket_id for item in body.scans}
    known = {tid for (tid,) in db.query(Ticket.id).filter(Ticket.id.in_(ids)).all()} if ids else set()

    for item in body.scans:
        if item.ticket_id not in known:
            # A QR naming a ticket that doesn't exist (forged/garbled). An
            # admission for it can't be right, so it isn't stored as one; a
            # denial is kept, against the raw scanned id. (Postgres enforces
            # the tickets foreign key — inserting it as ticket_id would fail
            # the whole batch.)
            if item.granted:
                results.append(ScanUploadResultItem(
                    ticket_id=item.ticket_id, status="conflict",
                    detail="No such ticket exists, so this admission wasn't recorded",
                ))
                continue
            duplicate = (
                db.query(Attendance)
                .filter(
                    Attendance.ticket_id.is_(None),
                    Attendance.scanned_ref == item.ticket_id[:64],
                    Attendance.scanner_id == scanner.id,
                    Attendance.scan_time == item.scanned_at,
                )
                .first()
            )
            if duplicate:
                results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="duplicate"))
                continue
            db.add(Attendance(
                ticket_id=None, scanned_ref=item.ticket_id[:64], event_id=scanner.event_id,
                scanner_id=scanner.id, scan_time=item.scanned_at,
                status=AttendanceStatus.DENIED, denial_reason=item.reason_code,
            ))
            results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="recorded"))
            continue

        if item.granted:
            existing_admit = (
                db.query(Attendance)
                .filter(Attendance.ticket_id == item.ticket_id, Attendance.status == AttendanceStatus.ADMITTED)
                .first()
            )
            if existing_admit:
                if existing_admit.scanner_id == scanner.id:
                    results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="duplicate"))
                else:
                    results.append(ScanUploadResultItem(
                        ticket_id=item.ticket_id,
                        status="conflict",
                        detail=(
                            f"Already admitted by scanner {existing_admit.scanner_id} "
                            f"at {existing_admit.scan_time.isoformat()}"
                        ),
                    ))
                continue

            db.add(Attendance(
                ticket_id=item.ticket_id,
                event_id=scanner.event_id,
                scanner_id=scanner.id,
                scan_time=item.scanned_at,
                status=AttendanceStatus.ADMITTED,
            ))
            admitted.append(item.ticket_id)
            results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="recorded"))

        else:
            existing_denial = (
                db.query(Attendance)
                .filter(
                    Attendance.ticket_id == item.ticket_id,
                    Attendance.scanner_id == scanner.id,
                    Attendance.status == AttendanceStatus.DENIED,
                    Attendance.denial_reason == item.reason_code,
                    Attendance.scan_time == item.scanned_at,
                )
                .first()
            )
            if existing_denial:
                results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="duplicate"))
                continue

            db.add(Attendance(
                ticket_id=item.ticket_id,
                event_id=scanner.event_id,
                scanner_id=scanner.id,
                scan_time=item.scanned_at,
                status=AttendanceStatus.DENIED,
                denial_reason=item.reason_code,
            ))
            results.append(ScanUploadResultItem(ticket_id=item.ticket_id, status="recorded"))

    db.commit()
    if settings.BLOCKCHAIN_CONFIGURED:
        for ticket_id in admitted:
            mark_ticket_used_onchain.delay(ticket_id)
    return results
