"""
Organiser Console API — every read and action the console's pages need,
scoped to one organisation: /organisations/{organization_id}/...

Before this, the console ran on the frontend mock only. Every number here is
computed from real rows (payments, tickets, transfers, attendance, gate
scanners, the audit log); nothing is simulated. Where the platform simply
doesn't do something yet, the response says so (e.g. totalPaidOut is 0
because no payout is ever executed, avg_gas_cost_usd is null because gas
spend isn't recorded) rather than inventing a figure.

Access: any member (OWNER or STAFF) can read; actions that create value or
change settings (complimentary tickets, profile, payout details) are
OWNER-only. Manual admission is a scan, which staff may do.
"""
import csv
import io
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.authz import require_org_role
from app.core.config import get_settings
from app.core.crypto import encrypt_secret
from app.db.session import get_db
from app.models.models import (
    Attendance, AttendanceStatus, AuditLog, Barcode, BarcodeStatus, Event, EventStatus, GateScanner,
    GateScannerStatus, Organizer, OrganizerMember, OrganizerRole, Payment, PaymentStatus, Ticket,
    TicketStatus, Transfer, TransferStatus,
)
from app.schemas.schemas import (
    ComplimentaryTicketRequest, ConsoleScanRequest, ExportRequest, ManualOverrideRequest, OrganisationProfileUpdate,
    PayoutDetailsUpdate,
)
from app.services import organiser_service
from app.services.auth_service import get_or_create_user
from app.services.gate_partitioning import assign_gate
from app.services.platform_settings import DEFAULT_FEES, FeeHistory, current_fees
from app.services.totp_service import generate_totp_secret
from app.worker import mark_ticket_used_onchain, mint_ticket_nft

router = APIRouter(prefix="/organisations/{organization_id}", tags=["Organiser Console"])
logger = logging.getLogger(__name__)
settings = get_settings()

read_access = require_org_role(OrganizerRole.STAFF)
owner_access = require_org_role(OrganizerRole.OWNER)

# The platform fee, per-ticket scanning fee (spec.md §5.3) and how long
# after the event organiser earnings release all come from the admin's fee
# schedule (app/services/platform_settings.py), at the rates in force when
# each sale was paid.
# A paid ticket still unminted after this long is treated as a failed mint.
MINT_GRACE = timedelta(minutes=10)

_HELD_STATUSES = (TicketStatus.ACTIVE, TicketStatus.USED, TicketStatus.RESALE)
_SOLD_TRANSFER_STATUSES = (TransferStatus.PAID, TransferStatus.COMPLETED, TransferStatus.SETTLEMENT_FAILED)
EXPORT_TYPES = ("ticket_sales", "attendance", "royalty_ledger", "payouts")


# ── Helpers ─────────────────────────────────────────────────────────────────

def _now() -> datetime:
    """Naive UTC, matching how every DateTime column round-trips."""
    return datetime.utcnow()


def _naive(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _mask(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return "*" * max(len(digits) - 3, 0) + digits[-3:]


def _org(db: Session, organization_id: str) -> Organizer:
    org = db.query(Organizer).filter(Organizer.id == organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return org


def _events(db: Session, organization_id: str) -> list[Event]:
    return (
        db.query(Event)
        .filter(Event.organizer_id == organization_id)
        .order_by(Event.created_at.desc())
        .all()
    )


def _event(db: Session, organization_id: str, event_id: str) -> Event:
    event = db.query(Event).filter(Event.id == event_id, Event.organizer_id == organization_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _tickets(db: Session, event_ids: list[str]) -> list[Ticket]:
    if not event_ids:
        return []
    return db.query(Ticket).filter(Ticket.event_id.in_(event_ids)).all()


def _gate_names(db: Session, event: Event) -> list[str]:
    """Sorted names of the gates with a registered device — exactly the list
    /gate/sync-event partitions tickets over."""
    names = {
        s.gate_name
        for s in db.query(GateScanner).filter(GateScanner.event_id == event.id).all()
        if s.gate_name
    }
    return sorted(names)


def _primary_payments(db: Session, event_ids: list[str]) -> list[Payment]:
    """Successful original-purchase payments (resale payments excluded —
    their money belongs to the seller, minus fees and the royalty)."""
    if not event_ids:
        return []
    resale_payment_ids = {
        pid for (pid,) in db.query(Transfer.payment_id).filter(Transfer.payment_id.isnot(None)).all()
    }
    payments = (
        db.query(Payment)
        .join(Ticket, Payment.ticket_id == Ticket.id)
        .filter(Ticket.event_id.in_(event_ids), Payment.status == PaymentStatus.SUCCESS)
        .all()
    )
    return [p for p in payments if p.id not in resale_payment_ids]


def _completed_resales(db: Session, event_ids: list[str]) -> list[Transfer]:
    if not event_ids:
        return []
    return (
        db.query(Transfer)
        .filter(Transfer.event_id.in_(event_ids), Transfer.status == TransferStatus.COMPLETED)
        .order_by(Transfer.transferred_at.desc())
        .all()
    )


def _ledger(db: Session, events: list[Event]) -> list[dict]:
    """Every organiser money movement: one row per primary sale (gross,
    platform fee, per-ticket scanning fee, net) and one per settled resale
    royalty. Each is charged, and releases a number of days after its
    event, per the fee schedule in force when it was paid."""
    history = FeeHistory(db)
    by_id = {e.id: e for e in events}
    event_ids = list(by_id)
    rows = []
    for p in _primary_payments(db, event_ids):
        event = by_id.get(p.ticket.event_id) if p.ticket else None
        if not event:
            continue
        gross = float(p.amount_kes)
        qty = p.quantity or 1
        at = _naive(p.confirmed_at) or _naive(p.initiated_at)
        fees = history.at(at)
        fee = round(gross * fees.platform_fee_percent / 100)
        scanning = fees.scanning_fee_kes * qty
        rows.append({
            "type": "primary_sale", "event": event, "gross": gross, "fee": fee, "scanning_fee": scanning,
            "net": gross - fee - scanning, "quantity": qty, "tier_id": p.tier_id, "at": at,
            "available_at": event.event_date + timedelta(days=fees.organiser_escrow_days),
        })
    for t in _completed_resales(db, event_ids):
        event = by_id.get(t.event_id)
        if not event:
            continue
        at = _naive(t.transferred_at) or _naive(t.created_at)
        rows.append({
            "type": "royalty", "event": event, "gross": 0.0, "fee": 0.0, "scanning_fee": 0.0,
            "net": float(t.organizer_royalty_kes or 0), "resale_price": float(t.transfer_price_kes or 0),
            "at": at, "available_at": event.event_date + timedelta(days=history.at(at).organiser_escrow_days),
        })
    return rows


def _release_at(rows: list[dict], event: Event) -> datetime:
    """When all of one event's earnings have released (rows from _ledger)."""
    return max((r["available_at"] for r in rows if r["event"].id == event.id),
               default=event.event_date + timedelta(days=DEFAULT_FEES.organiser_escrow_days))


def _wallet(rows: list[dict]) -> dict:
    now = _now()
    available = sum(r["net"] for r in rows if r["available_at"] <= now)
    pending = sum(r["net"] for r in rows if r["available_at"] > now)
    return {"available": round(available, 2), "pending": round(pending, 2)}


def _admitted_ids(db: Session, event_id: str, tickets: list[Ticket]) -> set[str]:
    """Admitted = marked USED by an online scan/override, or admitted in an
    uploaded offline scan (scan-upload writes Attendance without touching
    the ticket's status)."""
    ids = {t.id for t in tickets if t.event_id == event_id and t.status == TicketStatus.USED}
    ids |= {
        tid for (tid,) in db.query(Attendance.ticket_id)
        .filter(Attendance.event_id == event_id, Attendance.status == AttendanceStatus.ADMITTED).all()
    }
    return ids


def _scanner_status(s: GateScanner) -> str:
    if s.status == GateScannerStatus.ACTIVE:
        return "active"
    if s.enrollment_code:
        return "invited" if s.enrollment_code_expires_at and s.enrollment_code_expires_at > _now() else "expired"
    return "revoked"


def _ticket_row(db: Session, ticket: Ticket, gate_lists: dict[str, list[str]]) -> dict:
    event = ticket.event
    attendance = db.query(Attendance).filter(Attendance.ticket_id == ticket.id).all()
    transfers = db.query(Transfer).filter(Transfer.ticket_id == ticket.id).order_by(Transfer.created_at).all()

    timeline = []
    timeline.append({
        "label": "Issued (complimentary)" if ticket.is_complimentary else "Order placed",
        "at": _iso(_naive(ticket.created_at)),
    })
    if ticket.purchased_at and not ticket.is_complimentary:
        timeline.append({"label": "Payment confirmed", "at": _iso(_naive(ticket.purchased_at))})
    if ticket.nft_token_id:
        # No mint timestamp is stored; mints follow payment within seconds
        # when the worker is running, so it's placed at the payment time.
        timeline.append({
            "label": f"Minted on-chain (#{ticket.nft_token_id})",
            "at": _iso(_naive(ticket.purchased_at or ticket.created_at)),
            "tx_hash": ticket.nft_tx_hash,
        })
    for tr in transfers:
        timeline.append({"label": "Listed for resale", "at": _iso(_naive(tr.created_at)), "tx_hash": tr.listing_tx_hash})
        if tr.status == TransferStatus.COMPLETED and tr.transferred_at:
            timeline.append({"label": "Resold", "at": _iso(_naive(tr.transferred_at)), "tx_hash": tr.settlement_tx_hash})
    for gift in db.query(AuditLog).filter(AuditLog.action_type == "ticket_transferred", AuditLog.target_id == ticket.id).all():
        timeline.append({"label": "Given to another attendee", "at": _iso(_naive(gift.created_at))})
    admitted_rows = [a for a in attendance if a.status == AttendanceStatus.ADMITTED]
    if ticket.used_at:
        timeline.append({"label": "Admitted at gate", "at": _iso(_naive(ticket.used_at))})
    elif admitted_rows:
        timeline.append({"label": "Admitted at gate (offline)", "at": _iso(_naive(admitted_rows[0].scan_time))})
    timeline = sorted((t for t in timeline if t["at"]), key=lambda t: t["at"])

    suspicious = []
    denied = [a for a in attendance if a.status == AttendanceStatus.DENIED]
    if len(denied) >= 2:
        suspicious.append(f"{len(denied)} failed scan attempts")
    if len({a.scanner_id for a in admitted_rows}) > 1:
        suspicious.append("Admitted by more than one gate device")
    resold = [t for t in transfers if t.status in _SOLD_TRANSFER_STATUSES]
    if len(resold) >= 2:
        suspicious.append(f"Resold {len(resold)} times")

    gates = gate_lists.get(ticket.event_id) or []
    return {
        "ticket_id": ticket.id,
        "event_id": ticket.event_id,
        "event_title": event.title if event else None,
        "tier_name": ticket.tier.tier_name if ticket.tier else None,
        "holder_phone_masked": _mask(ticket.owner.phone_number if ticket.owner else ""),
        "holder_name": ticket.owner.display_name if ticket.owner else None,
        "status": ticket.status.value,
        "purchased_at": _iso(_naive(ticket.purchased_at)),
        "nft_token_id": ticket.nft_token_id,
        "chain_status": "verified" if ticket.nft_token_id else "pending",
        "gate_assignment": assign_gate(ticket.id, gates) if gates else None,
        "checked_in": ticket.status == TicketStatus.USED or bool(admitted_rows),
        "is_complimentary": bool(ticket.is_complimentary),
        "timeline": timeline,
        "suspicious": suspicious,
    }


def _gate_lists(db: Session, events: list[Event]) -> dict[str, list[str]]:
    return {e.id: _gate_names(db, e) for e in events}


# ── Events ──────────────────────────────────────────────────────────────────

@router.get("/events")
def list_events(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    """Every event this organisation owns, any status, hidden tiers included."""
    org = _org(db, organization_id)
    return [organiser_service.event_out(e, org) for e in _events(db, organization_id)]


@router.get("/events/{event_id}")
def get_event(organization_id: str, event_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    return organiser_service.event_out(_event(db, organization_id, event_id), _org(db, organization_id))


# ── Control Center ──────────────────────────────────────────────────────────

@router.get("/control-center")
def control_center(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    org = _org(db, organization_id)
    events = _events(db, organization_id)
    rows = _ledger(db, events)
    now = _now()

    live_now = []
    for e in events:
        tickets = [t for t in _tickets(db, [e.id])]
        admitted = len(_admitted_ids(db, e.id, tickets))
        denied = db.query(Attendance).filter(Attendance.event_id == e.id, Attendance.status == AttendanceStatus.DENIED).count()
        recent_scan = db.query(Attendance).filter(
            Attendance.event_id == e.id, Attendance.scan_time >= now - timedelta(hours=2)
        ).first() is not None
        starting_soon = abs((e.event_date - now).total_seconds()) < 6 * 3600
        if not (recent_scan or starting_soon):
            continue
        scanners = db.query(GateScanner).filter(GateScanner.event_id == e.id).all()
        syncs = [s.last_sync_at for s in scanners if s.last_sync_at]
        total = admitted + denied
        live_now.append({
            "event_id": e.id,
            "event_title": e.title,
            "ticketsScanned": total,
            "admissionRate": round(admitted / total * 100) if total else 0,
            "gatesOnline": sum(1 for s in scanners if s.status == GateScannerStatus.ACTIVE),
            "lastSyncAt": _iso(max(syncs)) if syncs else None,
        })

    return {
        "organiserName": org.business_name,
        # No subscription/plan model exists — nothing to show.
        "activePlans": [],
        "wallet": _wallet(rows),
        "allTimeTickets": sum(r["quantity"] for r in rows if r["type"] == "primary_sale"),
        "allTimeRevenueKes": sum(r["gross"] for r in rows if r["type"] == "primary_sale"),
        "events": [
            {"id": e.id, "title": e.title, "tiers": [{"id": t.id, "name": t.tier_name} for t in e.tiers]}
            for e in events if e.status == EventStatus.PUBLISHED
        ],
        "liveNow": live_now,
    }


@router.post("/complimentary-tickets", status_code=status.HTTP_201_CREATED)
def send_complimentary_ticket(
    organization_id: str,
    body: ComplimentaryTicketRequest,
    member: OrganizerMember = Depends(owner_access),
    db: Session = Depends(get_db),
):
    """Issue a free ticket to someone by phone number. It's a real ticket:
    an active credential, counted against capacity, minted like any other."""
    event = _event(db, organization_id, body.event_id)
    if event.status in (EventStatus.CANCELLED, EventStatus.COMPLETED):
        raise HTTPException(status_code=400, detail=f"This event is {event.status.value} — no new tickets can be issued")
    tier = next((t for t in event.tiers if t.id == body.tier_id), None) if body.tier_id else (event.tiers[0] if event.tiers else None)
    if not tier:
        raise HTTPException(status_code=404, detail="Ticket tier not found for this event")
    if tier.tickets_remaining < 1 or event.tickets_remaining < 1:
        raise HTTPException(status_code=400, detail="This tier is sold out — there's no capacity left to issue a ticket from")

    recipient = get_or_create_user(db, body.recipient_phone)
    now = datetime.now(timezone.utc)
    ticket = Ticket(
        event_id=event.id, tier_id=tier.id, owner_id=recipient.id, status=TicketStatus.ACTIVE,
        purchased_at=now, is_complimentary=True, complimentary_note=(body.note or None),
        recipient_name=body.recipient_name,
    )
    db.add(ticket)
    db.flush()
    db.add(Barcode(
        ticket_id=ticket.id, event_id=event.id, owner_id=recipient.id,
        token=encrypt_secret(generate_totp_secret()), token_version=1, status=BarcodeStatus.ACTIVE,
    ))
    tier.tickets_sold += 1
    event.tickets_sold += 1
    db.add(AuditLog(
        actor_id=member.account_id, action_type="complimentary_ticket", target_id=ticket.id,
        target_type="ticket", details=f"to {body.recipient_name} ({_mask(body.recipient_phone)})",
    ))
    db.commit()

    mint_ticket_nft.delay(ticket.id)
    return {"success": True, "ticket_id": ticket.id}


@router.get("/guest-lists")
def guest_lists(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    event_ids = [e.id for e in _events(db, organization_id)]
    if not event_ids:
        return []
    comps = (
        db.query(Ticket)
        .filter(Ticket.event_id.in_(event_ids), Ticket.is_complimentary.is_(True))
        .order_by(Ticket.created_at.desc())
        .all()
    )
    return [{
        "ticket_id": t.id,
        "event_title": t.event.title if t.event else None,
        "tier_name": t.tier.tier_name if t.tier else None,
        "recipient_name": t.recipient_name,
        "recipient_phone_masked": _mask(t.owner.phone_number if t.owner else ""),
        "note": t.complimentary_note,
        "status": t.status.value,
        "issued_at": _iso(_naive(t.created_at)),
    } for t in comps]


# ── Analytics ───────────────────────────────────────────────────────────────

@router.get("/attendance")
def attendance_summary(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    out = []
    for e in _events(db, organization_id):
        tickets = _tickets(db, [e.id])
        held = [t for t in tickets if t.status in _HELD_STATUSES]
        admitted = len(_admitted_ids(db, e.id, tickets))
        out.append({
            "event_id": e.id,
            "event_title": e.title,
            "event_date": _iso(e.event_date),
            "capacity": e.total_capacity,
            "sold": len(held),
            "admitted": admitted,
            "admissionRate": round(admitted / len(held) * 100) if held else 0,
        })
    return out


@router.get("/revenue-breakdown")
def revenue_breakdown(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    events = _events(db, organization_id)
    by_category: dict[str, float] = defaultdict(float)
    by_tier: dict[str, dict] = {}
    tier_names = {t.id: (e.title, t.tier_name) for e in events for t in e.tiers}
    for r in _ledger(db, events):
        if r["type"] != "primary_sale":
            continue
        by_category[r["event"].category or "Uncategorised"] += r["gross"]
        if r["tier_id"] in tier_names:
            row = by_tier.setdefault(r["tier_id"], {
                "event_title": tier_names[r["tier_id"]][0], "tier_name": tier_names[r["tier_id"]][1],
                "tickets_sold": 0, "revenue": 0.0,
            })
            row["tickets_sold"] += r["quantity"]
            row["revenue"] += r["gross"]
    return {
        "byCategory": [{"category": c, "revenue": v} for c, v in sorted(by_category.items(), key=lambda kv: -kv[1])],
        "byTier": sorted(by_tier.values(), key=lambda r: -r["revenue"]),
    }


@router.get("/earnings")
def earnings(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    events = _events(db, organization_id)
    rows = _ledger(db, events)
    primary = [r for r in rows if r["type"] == "primary_sale"]
    royalties = [r for r in rows if r["type"] == "royalty"]
    wallet = _wallet(rows)
    now = _now()

    per_event = []
    for e in events:
        ep = [r for r in primary if r["event"].id == e.id]
        er = [r for r in royalties if r["event"].id == e.id]
        online = sum(r["gross"] for r in ep)
        royalty_kes = sum(r["net"] for r in er)
        if not online and not royalty_kes:
            continue
        fees = sum(r["fee"] + r["scanning_fee"] for r in ep)
        tier_rows = []
        for t in e.tiers:
            tp = [r for r in ep if r["tier_id"] == t.id]
            tier_rows.append({"name": t.tier_name, "sold": sum(r["quantity"] for r in tp), "revenue": sum(r["gross"] for r in tp)})
        per_event.append({
            "event_id": e.id,
            "event_title": e.title,
            "event_date": _iso(e.event_date),
            "online_sales_kes": online,
            "gate_sales_kes": 0,  # no cash/door-sales flow exists
            "resale_royalties_kes": royalty_kes,
            "fees_kes": fees,
            "net_kes": online - fees + royalty_kes,
            "payout_status": "Available" if _release_at(rows, e) <= now else "Pending",
            "tiers": tier_rows,
        })

    by_day: dict[str, dict] = {}
    for r in rows:
        if not r["at"]:
            continue
        day = r["at"].date().isoformat()
        bucket = by_day.setdefault(day, {"date": day, "primary": 0.0, "resale": 0.0})
        if r["type"] == "primary_sale":
            bucket["primary"] += r["gross"]
        else:
            bucket["resale"] += r["net"]

    return {
        "wallet": {
            "onlinePending": wallet["pending"],
            "availableBalance": wallet["available"],
            # Payouts are never executed by this platform yet.
            "totalPaidOut": 0,
            "minPayoutKes": current_fees(db).min_payout_kes,
        },
        "totals": {
            "totalRevenue": sum(r["gross"] for r in primary),
            "chaintixFee": sum(r["fee"] for r in primary),
            "scanningFees": sum(r["scanning_fee"] for r in primary),
            "yourEarnings": sum(r["net"] for r in rows),
            "ticketsSold": sum(r["quantity"] for r in primary),
        },
        "royaltyIncome": {
            "resaleCount": len(royalties),
            "grossResaleValue": sum(r["resale_price"] for r in royalties),
            "royaltyEarned": sum(r["net"] for r in royalties),
        },
        "perEventBreakdown": per_event,
        "revenueOverTime": sorted(by_day.values(), key=lambda b: b["date"]),
    }


@router.get("/reports")
def reports(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    """One sales statement per event with sales — generated live on download."""
    events = _events(db, organization_id)
    sales_by_event: dict[str, datetime] = {}
    for r in _ledger(db, events):
        if r["type"] == "primary_sale" and r["at"]:
            eid = r["event"].id
            sales_by_event[eid] = max(sales_by_event.get(eid, r["at"]), r["at"])
    return [
        {"id": e.id, "title": f"{e.title} — Sales Statement", "event_title": e.title, "generated_at": _iso(sales_by_event[e.id])}
        for e in events if e.id in sales_by_event
    ]


@router.get("/reports/{event_id}/download")
def download_report(organization_id: str, event_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    event = _event(db, organization_id, event_id)
    return _csv_response(*_export_rows(db, organization_id, "ticket_sales", [event]), f"sales-statement-{event.id[:8]}.csv")


# ── Tickets ─────────────────────────────────────────────────────────────────

@router.get("/tickets")
def ticket_central(
    organization_id: str,
    event_id: str | None = None,
    status_filter: str | None = None,
    query: str | None = None,
    _m: OrganizerMember = Depends(read_access),
    db: Session = Depends(get_db),
):
    events = _events(db, organization_id)
    if event_id:
        events = [e for e in events if e.id == event_id]
    event_ids = [e.id for e in events]
    if not event_ids:
        return []
    q = db.query(Ticket).filter(Ticket.event_id.in_(event_ids))
    if status_filter:
        try:
            q = q.filter(Ticket.status == TicketStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown ticket status: {status_filter}")
    tickets = q.order_by(Ticket.created_at.desc()).limit(500).all()
    if query:
        needle = query.strip().lower()
        titles = {e.id: e.title.lower() for e in events}
        tickets = [t for t in tickets if needle in t.id.lower() or needle in titles.get(t.event_id, "")]
    gate_lists = _gate_lists(db, events)
    return [_ticket_row(db, t, gate_lists) for t in tickets]


@router.get("/audit-lookup")
def audit_lookup(organization_id: str, q: str = "", _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    """Find tickets by ticket ID, holder phone, or M-Pesa receipt number."""
    needle = q.strip()
    if not needle:
        return []
    events = _events(db, organization_id)
    event_ids = [e.id for e in events]
    if not event_ids:
        return []

    matches: dict[str, Ticket] = {}
    for t in db.query(Ticket).filter(Ticket.event_id.in_(event_ids), Ticket.id.ilike(f"%{needle}%")).limit(50):
        matches[t.id] = t

    digits = "".join(ch for ch in needle if ch.isdigit())
    if len(digits) >= 6:
        phone = "254" + digits[1:] if digits.startswith("0") else digits
        owners = [t for t in db.query(Ticket).filter(Ticket.event_id.in_(event_ids)).all() if t.owner and phone in t.owner.phone_number]
        for t in owners[:50]:
            matches[t.id] = t

    payment = db.query(Payment).filter(Payment.mpesa_receipt_number.ilike(needle)).first()
    if payment:
        for t in db.query(Ticket).filter(
            ((Ticket.id == payment.ticket_id) | (Ticket.group_payment_id == payment.id)),
            Ticket.event_id.in_(event_ids),
        ):
            matches[t.id] = t

    gate_lists = _gate_lists(db, events)
    return [_ticket_row(db, t, gate_lists) for t in matches.values()]


# ── Crowd control & scanners ────────────────────────────────────────────────

@router.get("/events/{event_id}/crowd-control")
def crowd_control(organization_id: str, event_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    event = _event(db, organization_id, event_id)
    tickets = _tickets(db, [event.id])
    held = [t for t in tickets if t.status in _HELD_STATUSES]
    admitted_ids = _admitted_ids(db, event.id, tickets)
    attendance = db.query(Attendance).filter(Attendance.event_id == event.id).all()
    denied = sum(1 for a in attendance if a.status == AttendanceStatus.DENIED)
    scanners = {s.id: s for s in db.query(GateScanner).filter(GateScanner.event_id == event.id).all()}

    by_gate: dict[str, dict] = {}
    offline_admitted = set()
    for a in attendance:
        scanner = scanners.get(a.scanner_id)
        gate = scanner.gate_name if scanner else "Manual / online"
        row = by_gate.setdefault(gate, {"gate": gate, "admitted": 0, "denied": 0})
        if a.status == AttendanceStatus.ADMITTED:
            row["admitted"] += 1
            offline_admitted.add(a.ticket_id)
        else:
            row["denied"] += 1
    online_only = len(admitted_ids - offline_admitted)
    if online_only:
        row = by_gate.setdefault("Manual / online", {"gate": "Manual / online", "admitted": 0, "denied": 0})
        row["admitted"] += online_only

    gate_names = _gate_names(db, event)
    assigned: dict[str, int] = defaultdict(int)
    if gate_names:
        for t in held:
            assigned[assign_gate(t.id, gate_names)] += 1
    gates = []
    for g in (event.gates or []):
        devices = [s for s in scanners.values() if s.gate_name == g["name"]]
        syncs = [s.last_sync_at for s in devices if s.last_sync_at]
        gates.append({
            "gate_id": g["id"],
            "gate_name": g["name"],
            "online": any(s.status == GateScannerStatus.ACTIVE for s in devices),
            "last_sync_at": _iso(max(syncs)) if syncs else None,
            "cached_tickets": assigned.get(g["name"], 0),
        })

    admitted = len(admitted_ids)
    return {
        "event_title": event.title,
        "capacity": event.total_capacity,
        "admitted": admitted,
        "denied": denied,
        "admissionRate": round(admitted / (admitted + denied) * 100) if admitted + denied else 0,
        "throughputByGate": list(by_gate.values()),
        "gates": gates,
        # Ticket holders not yet through the gate. There is no queue sensor,
        # so this is the honest upper bound, not a queue-length estimate.
        "queueEstimate": max(0, len(held) - admitted),
    }


@router.post("/events/{event_id}/manual-override")
def manual_override(
    organization_id: str,
    event_id: str,
    body: ManualOverrideRequest,
    member: OrganizerMember = Depends(read_access),
    db: Session = Depends(get_db),
):
    """Admit a ticket without a scan. Recorded as an attendance row and in
    the audit log with the reason."""
    event = _event(db, organization_id, event_id)
    ticket = db.query(Ticket).filter(Ticket.id == body.ticket_id.strip(), Ticket.event_id == event.id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found for this event.")
    if ticket.status == TicketStatus.USED:
        raise HTTPException(status_code=400, detail="This ticket has already been admitted.")
    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"This ticket can't be admitted — its status is {ticket.status.value}.")

    now = _now()
    ticket.status = TicketStatus.USED
    ticket.used_at = now
    db.add(Attendance(ticket_id=ticket.id, event_id=event.id, scanner_id=None, scan_time=now, status=AttendanceStatus.ADMITTED))
    db.add(AuditLog(
        actor_id=member.account_id, action_type="manual_override", target_id=ticket.id,
        target_type="ticket", details=body.reason,
    ))
    db.commit()
    _record_admission_onchain(ticket.id)
    return {"success": True}


def _record_admission_onchain(ticket_id: str) -> None:
    """Queue TiketiNFT.markUsed for an admitted ticket (app/worker.py)."""
    if settings.BLOCKCHAIN_CONFIGURED:
        mark_ticket_used_onchain.delay(ticket_id)


@router.post("/events/{event_id}/scan")
def console_scan(
    organization_id: str,
    event_id: str,
    body: ConsoleScanRequest,
    _m: OrganizerMember = Depends(read_access),
    db: Session = Depends(get_db),
):
    """
    Check a ticket at the door from Live QR Scanner (a phone's camera or a
    typed code). For this organisation's staff only; rejects tickets for
    other events, and records every
    decision as attendance (validate.js's reason codes, plus WRONG_EVENT
    and NOT_ACTIVE), so it counts in Attendance and Crowd Control.
    """
    from app.services.totp_service import verify_otp as totp_verify

    event = _event(db, organization_id, event_id)
    now = _now()
    parts = body.qr_payload.strip().split(":")
    if len(parts) != 3 or parts[0] != "TIKETI":
        # Any QR the camera happens to catch lands here — not worth a record.
        return {"valid": False, "code": "INVALID_FORMAT", "reason": "That isn't a ChainTix ticket QR code."}
    ticket_ref, otp = parts[1], parts[2]
    ticket = db.query(Ticket).filter(Ticket.id == ticket_ref).first()

    def deny(code: str, reason: str) -> dict:
        db.add(Attendance(ticket_id=ticket.id if ticket else None, scanned_ref=None if ticket else ticket_ref[:64],
                          event_id=event.id, scanner_id=None, scan_time=now, status=AttendanceStatus.DENIED,
                          denial_reason=code))
        db.commit()
        return {"valid": False, "code": code, "reason": reason, "ticket_id": ticket.id if ticket else None}

    if not ticket:
        return deny("UNKNOWN_TICKET", "Ticket not found.")
    if ticket.event_id != event.id:
        other = db.get(Event, ticket.event_id)
        return deny("WRONG_EVENT", f"This ticket is for {other.title if other else 'another event'}.")
    if not totp_verify(ticket.totp_secret, otp):
        return deny("BAD_OTP", "This code has expired. Ask them to open the ticket on their phone again.")
    if ticket.status == TicketStatus.USED:
        return {**deny("ALREADY_ADMITTED", "Already admitted."), "used_at": _iso(_naive(ticket.used_at))}
    if ticket.status != TicketStatus.ACTIVE:
        why = "it's listed for resale" if ticket.status == TicketStatus.RESALE else f"its status is {ticket.status.value}"
        return deny("NOT_ACTIVE", f"Can't admit this ticket: {why}.")

    ticket.status = TicketStatus.USED
    ticket.used_at = now
    db.add(Attendance(ticket_id=ticket.id, event_id=event.id, scanner_id=None, scan_time=now, status=AttendanceStatus.ADMITTED))
    db.commit()
    _record_admission_onchain(ticket.id)
    return {
        "valid": True,
        "ticket_id": ticket.id,
        "event_title": event.title,
        "tier_name": ticket.tier.tier_name if ticket.tier else None,
        "owner_phone": _mask(ticket.owner.phone_number if ticket.owner else None),
        # So door staff can check it against an ID.
        "holder_name": ticket.owner.display_name if ticket.owner else None,
        "complimentary": bool(ticket.is_complimentary),
        "scanned_at": _iso(now),
    }


@router.get("/scanners")
def scanner_devices(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    events = {e.id: e for e in _events(db, organization_id)}
    scanners = (
        db.query(GateScanner)
        .filter(GateScanner.organizer_id == organization_id)
        .order_by(GateScanner.created_at.desc())
        .all()
    )
    out = []
    for s in scanners:
        event = events.get(s.event_id)
        scans = db.query(Attendance).filter(Attendance.scanner_id == s.id).all()
        cached = 0
        if event and s.status == GateScannerStatus.ACTIVE:
            names = _gate_names(db, event)
            cached = sum(
                1 for t in _tickets(db, [event.id])
                if t.status in _HELD_STATUSES and assign_gate(t.id, names) == s.gate_name
            )
        state = _scanner_status(s)
        out.append({
            "id": s.id,
            "device_name": s.label or f"{s.gate_name} device",
            "event_id": s.event_id,
            "event_title": event.title if event else None,
            "gate_name": s.gate_name,
            "status": state,
            "enrollment_code": s.enrollment_code if state == "invited" else None,
            "enrollment_expires_at": _iso(s.enrollment_code_expires_at) if state == "invited" else None,
            "last_sync_at": _iso(s.last_sync_at),
            "tickets_cached": cached,
            "total_scans": len(scans),
            "invalid_attempts": sum(1 for a in scans if a.status == AttendanceStatus.DENIED),
        })
    return out


# ── Blockchain ──────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/contract-status")
def contract_status(organization_id: str, event_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    event = _event(db, organization_id, event_id)
    paid = [t for t in _tickets(db, [event.id]) if t.status in _HELD_STATUSES]
    minted = [t for t in paid if t.nft_token_id]
    now = _now()
    unminted = [t for t in paid if not t.nft_token_id]
    stuck = [t for t in unminted if t.purchased_at and _naive(t.purchased_at) < now - MINT_GRACE]
    rpc = settings.BLOCKCHAIN_RPC_URL or ""
    network = "Base Sepolia" if "sepolia.base" in rpc else ("Local chain" if "127.0.0.1" in rpc or "localhost" in rpc else (rpc or "Not configured"))
    return {
        "event_title": event.title,
        "blockchain_configured": settings.BLOCKCHAIN_CONFIGURED,
        "contract_address": settings.NFT_CONTRACT_ADDRESS or None,
        "network": network,
        "deployed_at": None,  # not recorded anywhere; one contract serves every event
        "resale_cap_percent": round(organiser_service.resale_multiplier(event) * 100),
        "royalty_percent": event.resale_royalty_percent,
        "total_minted": len(minted),
        "mint_success_rate": round(len(minted) / len(paid) * 100) if paid else 100,
        "avg_gas_cost_usd": None,  # gas spend isn't recorded
        "failed_mint_queue": [
            {
                "ticket_id": t.id,
                "reason": f"Ticket {t.id[:8]} was paid {int((now - _naive(t.purchased_at)).total_seconds() // 60)} min ago "
                          "but hasn't minted. Is the Celery worker running?",
            }
            for t in stuck
        ],
        "pending_mints": len(unminted) - len(stuck),
    }


@router.get("/royalty-ledger")
def royalty_ledger(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    events = {e.id: e for e in _events(db, organization_id)}
    return [{
        "id": t.id,
        "date": _iso(_naive(t.transferred_at)),
        "event_title": events[t.event_id].title if t.event_id in events else None,
        "ticket_id": t.ticket_id,
        "resale_price_kes": t.transfer_price_kes,
        "royalty_kes": t.organizer_royalty_kes,
        "tx_hash": t.settlement_tx_hash,
        "status": "success",
    } for t in _completed_resales(db, list(events))]


@router.get("/resale-compliance")
def resale_compliance(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    events = {e.id: e for e in _events(db, organization_id)}
    if not events:
        return {"rejectedAboveCapAttempts": 0, "listingsPausedByCapChange": 0, "priceDistribution": []}
    rejected = (
        db.query(AuditLog)
        .filter(AuditLog.action_type == "resale_rejected_above_cap", AuditLog.target_id.in_(list(events)))
        .count()
    )
    listings = (
        db.query(Transfer)
        .filter(Transfer.event_id.in_(list(events)), Transfer.status.notin_((TransferStatus.CANCELLED, TransferStatus.EXPIRED)))
        .all()
    )
    return {
        "rejectedAboveCapAttempts": rejected,
        # Cap changes never pause existing listings (minted caps are fixed on-chain).
        "listingsPausedByCapChange": 0,
        "priceDistribution": [
            {"price": t.asking_price_kes, "face_value": t.ticket.tier.price_kes if t.ticket and t.ticket.tier else 0}
            for t in listings
        ],
    }


# ── Exports ─────────────────────────────────────────────────────────────────

def _export_rows(db: Session, organization_id: str, export_type: str, events: list[Event] | None = None) -> tuple[list[str], list[list]]:
    events = events if events is not None else _events(db, organization_id)
    event_ids = [e.id for e in events]
    if export_type == "ticket_sales":
        header = ["ticket_id", "event", "tier", "status", "complimentary", "price_kes", "purchased_at", "mpesa_receipt", "holder", "nft_token_id"]
        rows = []
        for t in _tickets(db, event_ids):
            if t.status == TicketStatus.PENDING_PAYMENT:
                continue
            original = t.payments[0] if t.payments else None
            receipt = original.mpesa_receipt_number if original else None
            if not receipt and t.group_payment_id:
                gp = db.query(Payment).filter(Payment.id == t.group_payment_id).first()
                receipt = gp.mpesa_receipt_number if gp else None
            rows.append([
                t.id, t.event.title if t.event else "", t.tier.tier_name if t.tier else "", t.status.value,
                "yes" if t.is_complimentary else "no", 0 if t.is_complimentary else (t.tier.price_kes if t.tier else ""),
                _iso(_naive(t.purchased_at)) or "", receipt or "", _mask(t.owner.phone_number if t.owner else ""),
                t.nft_token_id or "",
            ])
        return header, rows
    if export_type == "attendance":
        header = ["ticket_id", "event", "gate", "result", "reason", "scan_time"]
        scanners = {s.id: s for s in db.query(GateScanner).filter(GateScanner.organizer_id == organization_id).all()}
        titles = {e.id: e.title for e in events}
        rows = [
            [a.ticket_id or f"unknown:{a.scanned_ref}", titles.get(a.event_id, ""), scanners[a.scanner_id].gate_name if a.scanner_id in scanners else "Manual / online",
             a.status.value, a.denial_reason or "", _iso(a.scan_time)]
            for a in (db.query(Attendance).filter(Attendance.event_id.in_(event_ids)).order_by(Attendance.scan_time).all() if event_ids else [])
        ]
        return header, rows
    if export_type == "royalty_ledger":
        header = ["transfer_id", "date", "event", "ticket_id", "resale_price_kes", "royalty_kes", "tx_hash"]
        titles = {e.id: e.title for e in events}
        rows = [[t.id, _iso(_naive(t.transferred_at)) or "", titles.get(t.event_id, ""), t.ticket_id,
                 t.transfer_price_kes, t.organizer_royalty_kes, t.settlement_tx_hash or ""]
                for t in _completed_resales(db, event_ids)]
        return header, rows
    if export_type == "payouts":
        header = ["event", "event_date", "online_sales_kes", "fees_kes", "royalties_kes", "net_kes", "releases_on", "status"]
        ledger = _ledger(db, events)
        now = _now()
        rows = []
        for e in events:
            er = [r for r in ledger if r["event"].id == e.id]
            if not er:
                continue
            release = _release_at(er, e)
            rows.append([
                e.title, _iso(e.event_date), sum(r["gross"] for r in er), sum(r["fee"] + r["scanning_fee"] for r in er),
                sum(r["net"] for r in er if r["type"] == "royalty"), sum(r["net"] for r in er), release.date().isoformat(),
                "available (not yet paid out)" if release <= now else "pending",
            ])
        return header, rows
    raise HTTPException(status_code=400, detail=f"Unknown export type: {export_type}")


def _csv_response(header: list[str], rows: list[list], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _export_out(log: AuditLog) -> dict:
    export_type, _, fmt = (log.details or "").partition(":")
    return {"id": log.id, "type": export_type, "format": fmt or "csv", "status": "ready", "requested_at": _iso(_naive(log.created_at))}


@router.get("/exports")
def list_exports(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.action_type == "export", AuditLog.target_id == organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )
    return [_export_out(log) for log in logs]


@router.post("/exports", status_code=status.HTTP_201_CREATED)
def request_export(organization_id: str, body: ExportRequest, member: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    """Exports are generated on download from current data, so a request is
    ready immediately. Only CSV is produced."""
    if body.type not in EXPORT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown export type: {body.type}")
    if body.format != "csv":
        raise HTTPException(status_code=400, detail="PDF exports aren't available yet. Choose CSV.")
    log = AuditLog(actor_id=member.account_id, action_type="export", target_id=organization_id,
                   target_type="organisation", details=f"{body.type}:{body.format}")
    db.add(log)
    db.commit()
    db.refresh(log)
    return _export_out(log)


@router.get("/exports/{export_id}/download")
def download_export(organization_id: str, export_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    log = db.query(AuditLog).filter(
        AuditLog.id == export_id, AuditLog.action_type == "export", AuditLog.target_id == organization_id
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Export not found")
    export_type = (log.details or "").partition(":")[0]
    stamp = _now().strftime("%Y%m%d-%H%M")
    return _csv_response(*_export_rows(db, organization_id, export_type), f"{export_type}-{stamp}.csv")


# ── Settings ────────────────────────────────────────────────────────────────

def _profile_out(org: Organizer) -> dict:
    return {
        "businessName": org.business_name,
        "kraPin": org.kra_pin or "",
        "contactEmail": org.contact_email or "",
        "contactPhone": org.contact_phone or "",
        "verificationStatus": org.verification_status.value,
    }


@router.get("/profile")
def get_profile(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    return _profile_out(_org(db, organization_id))


@router.patch("/profile")
def update_profile(organization_id: str, body: OrganisationProfileUpdate, _m: OrganizerMember = Depends(owner_access), db: Session = Depends(get_db)):
    org = _org(db, organization_id)
    if body.businessName is not None:
        if not body.businessName.strip():
            raise HTTPException(status_code=400, detail="Business name can't be empty")
        org.business_name = body.businessName.strip()
    if body.kraPin is not None:
        org.kra_pin = body.kraPin.strip() or None
    if body.contactEmail is not None:
        org.contact_email = body.contactEmail.strip() or None
    if "contactPhone" in body.model_fields_set:
        org.contact_phone = body.contactPhone
    db.commit()
    return _profile_out(org)


@router.get("/payout-details")
def get_payout_details(organization_id: str, _m: OrganizerMember = Depends(read_access), db: Session = Depends(get_db)):
    org = _org(db, organization_id)
    return {"payoutMethod": org.payout_method or "mpesa", "payoutDestination": org.payout_destination or ""}


@router.patch("/payout-details")
def update_payout_details(organization_id: str, body: PayoutDetailsUpdate, _m: OrganizerMember = Depends(owner_access), db: Session = Depends(get_db)):
    org = _org(db, organization_id)
    org.payout_method = body.payoutMethod
    org.payout_destination = body.payoutDestination
    db.commit()
    return {"success": True}
