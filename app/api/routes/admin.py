"""
Platform Admin console (spec.md §7): ChainTix staff overseeing every
organiser, event and payment on the platform, not a scoped subset.

Every admin can read every page here. Changing something is limited by
admin role (app/core/authz.require_admin_role): compliance reviews
organisers and events, finance sets fees, support sends broadcasts, and
super admins do all of that plus admin users and feature flags. Every
change is written to the audit log.
"""
import csv
import io
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.routes.organiser_console import MINT_GRACE, _ledger, _primary_payments
from app.core.authz import admin_role, require_admin_role, require_platform_admin
from app.core.config import get_settings
from app.core.dependencies import get_optional_user
from app.db.session import get_db
from app.models.models import (
    AdminInvite, Attendance, AttendanceStatus, AuditLog, Broadcast, Event, EventStatus, FeatureFlag,
    FeeSchedule, GateScanner, Notification, Organizer, OrganizerMember, OrganizerVerificationStatus,
    Payment, PaymentStatus, Payout, PayoutStatus, Ticket, TicketStatus, Transfer, TransferStatus, User,
    WalletTransaction, WalletTransactionType,
)
from app.schemas.schemas import (
    AdminInviteRequest, AdminReasonRequest, BroadcastCreate, FeatureFlagRollout, FeeConfigUpdate,
    OrganiserReviewRequest, PayoutReceiptRequest,
)
from app.services import payouts as payout_service
from app.services.platform_settings import (
    DEFAULT_FEES, FLAG_SPECS, FLAGS, FeeHistory, current_fees, fees_from_row, flag_state,
)

router = APIRouter(prefix="/admin", tags=["Platform Admin"])
public_router = APIRouter(tags=["Announcements"])
settings = get_settings()

compliance_access = require_admin_role("compliance")
finance_access = require_admin_role("finance")
support_access = require_admin_role("support")
super_access = require_admin_role()

_HELD = (TicketStatus.ACTIVE, TicketStatus.USED, TicketStatus.RESALE)
_SOLD_TRANSFERS = (TransferStatus.PAID, TransferStatus.COMPLETED, TransferStatus.SETTLEMENT_FAILED)
_OPEN_LISTINGS = (TransferStatus.LISTED, TransferStatus.PAUSED, TransferStatus.PENDING_PAYMENT)
_PUBLIC = (EventStatus.PUBLISHED, EventStatus.SOLD_OUT)
NAIROBI = timedelta(hours=3)


def _now() -> datetime:
    return datetime.utcnow()


def _mask(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return "*" * max(len(digits) - 3, 0) + digits[-3:]


def _local_phone(phone: str | None) -> str:
    """254712345678 -> 0712 345 678."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("254"):
        digits = "0" + digits[3:]
    return f"{digits[:4]} {digits[4:7]} {digits[7:]}" if len(digits) == 10 else (phone or "")


def _audit(db: Session, admin: User, action: str, target_type: str, target_id: str | None, details: str | None = None):
    db.add(AuditLog(actor_id=admin.id, action_type=action, target_type=target_type, target_id=target_id, details=details))


def _get(db: Session, model, id_: str, what: str):
    row = db.get(model, id_)
    if not row:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return row


# ── Shared computations ─────────────────────────────────────────────────────

def _failed_mints(db: Session) -> int:
    """Paid tickets still without an NFT after the grace period."""
    if not settings.BLOCKCHAIN_CONFIGURED:
        return 0
    return (
        db.query(Ticket)
        .filter(Ticket.status.in_(_HELD), Ticket.nft_token_id.is_(None), Ticket.is_complimentary.is_(False),
                Ticket.purchased_at.isnot(None), Ticket.purchased_at < _now() - MINT_GRACE)
        .count()
    )


def _payout_queue(db: Session) -> list[dict]:
    now = _now()
    rows = []
    sales = (
        db.query(WalletTransaction)
        .filter(WalletTransaction.type == WalletTransactionType.SALE, WalletTransaction.available_at > now)
        .all()
    )
    phones = {u.id: u.phone_number for u in db.query(User).filter(User.id.in_({s.user_id for s in sales})).all()} if sales else {}
    for s in sales:
        rows.append({"id": s.id, "type": "seller", "recipient": _mask(phones.get(s.user_id)),
                     "description": s.description, "amount_kes": s.amount_kes, "available_at": s.available_at})

    events = db.query(Event).filter(Event.organizer_id.isnot(None)).all()
    orgs = {o.id: o.business_name for o in db.query(Organizer).all()}
    by_event = defaultdict(list)
    for r in _ledger(db, events):
        if r["available_at"] > now:
            by_event[r["event"].id].append(r)
    for event_rows in by_event.values():
        event = event_rows[0]["event"]
        sales_count = sum(r.get("quantity", 0) for r in event_rows if r["type"] == "primary_sale")
        royalties = sum(1 for r in event_rows if r["type"] == "royalty")
        parts = [f"{sales_count} ticket{'s' if sales_count != 1 else ''}"] if sales_count else []
        if royalties:
            parts.append(f"{royalties} resale royalt{'ies' if royalties != 1 else 'y'}")
        rows.append({
            "id": f"event:{event.id}", "type": "organiser", "recipient": orgs.get(event.organizer_id, "Organiser"),
            "description": f"{event.title} · {', '.join(parts)}",
            "amount_kes": round(sum(r["net"] for r in event_rows), 2),
            "available_at": max(r["available_at"] for r in event_rows),
        })
    return sorted(rows, key=lambda r: r["available_at"])


def _fraud_signals(db: Session) -> dict:
    titles = {e.id: e.title for e in db.query(Event.id, Event.title).all()}

    denied = Counter()
    denied_event = {}
    for a in db.query(Attendance).filter(Attendance.status == AttendanceStatus.DENIED).all():
        ref = a.ticket_id or a.scanned_ref
        if not ref:
            continue
        denied[ref] += 1
        denied_event[ref] = a.event_id
    repeated = [
        {"ticket_id": ref, "event_title": titles.get(denied_event[ref], "Unknown event"), "denied_count": n}
        for ref, n in denied.most_common() if n >= 3
    ]

    listings = Counter(
        seller for (seller,) in db.query(Transfer.seller_id).filter(Transfer.status.in_(_OPEN_LISTINGS + _SOLD_TRANSFERS)).all()
    )
    heavy = {uid: n for uid, n in listings.items() if n >= 3}
    phones = {u.id: u.phone_number for u in db.query(User).filter(User.id.in_(list(heavy))).all()} if heavy else {}
    velocity = sorted(
        ({"phone_masked": _mask(phones.get(uid)), "listing_count": n} for uid, n in heavy.items()),
        key=lambda r: -r["listing_count"],
    )

    events_by_device = defaultdict(set)
    for s in db.query(GateScanner).all():
        name = (s.label or "").strip()
        if name:
            events_by_device[name].add(s.event_id)
    duplicates = [
        {"device_name": name, "event_count": len(evs)}
        for name, evs in sorted(events_by_device.items()) if len(evs) > 1
    ]
    return {"repeatedFailedScans": repeated, "unusualVelocity": velocity, "duplicateDevices": duplicates}


# ── Dashboard & notifications ───────────────────────────────────────────────

@router.get("/dashboard")
def dashboard(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    now = _now()
    history = FeeHistory(db)
    events = db.query(Event).all()
    primary = _primary_payments(db, [e.id for e in events])
    resales = db.query(Transfer).filter(Transfer.status.in_(_SOLD_TRANSFERS)).all()

    primary_gross = sum(float(p.amount_kes) for p in primary)
    primary_fees = sum(round(float(p.amount_kes) * history.at(p.confirmed_at or p.initiated_at).platform_fee_percent / 100)
                       for p in primary)
    resale_gross = sum(float(t.transfer_price_kes or t.asking_price_kes or 0) for t in resales)
    resale_fees = sum(float(t.platform_fee_kes or 0) for t in resales)

    # "Today" is the Nairobi calendar day.
    today_start = (now + NAIROBI).replace(hour=0, minute=0, second=0, microsecond=0) - NAIROBI
    sold_today = (
        db.query(Ticket)
        .filter(Ticket.purchased_at >= today_start, Ticket.is_complimentary.is_(False), Ticket.status.in_(_HELD))
        .count()
    )
    active = sum(1 for e in events if e.status in _PUBLIC and (e.ends_at or e.event_date) >= now)
    return {
        "gmv": primary_gross + resale_gross,
        "platformFeeRevenue": primary_fees + resale_fees,
        "platformFeePercent": history.current().platform_fee_percent,
        "activeEvents": active,
        "ticketsSoldToday": sold_today,
        "organiserCount": db.query(Organizer).count(),
        "failedMintCount": _failed_mints(db),
        "payoutQueueDepth": len(_payout_queue(db)),
    }


@router.get("/notifications")
def notifications(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    notices = []

    def plural(n, word):
        return f"{n} {word}{'' if n == 1 else 's'}"

    pending_orgs = db.query(Organizer).filter(
        Organizer.verification_status == OrganizerVerificationStatus.PENDING, Organizer.suspended_at.is_(None)
    ).count()
    if pending_orgs:
        notices.append({"id": "n-organisers", "severity": "info", "link": "/admin/organisers",
                        "text": f"{plural(pending_orgs, 'organiser account')} awaiting verification"})
    pending_events = db.query(Event).filter(Event.review_state == "pending").count()
    if pending_events:
        notices.append({"id": "n-events", "severity": "info", "link": "/admin/events",
                        "text": f"{plural(pending_events, 'event')} awaiting approval"})
    fraud = _fraud_signals(db)
    flags = sum(len(v) for v in fraud.values())
    if flags:
        notices.append({"id": "n-fraud", "severity": "warning", "link": "/admin/fraud",
                        "text": f"{plural(flags, 'fraud signal')} flagged for review"})
    failed = _failed_mints(db)
    if failed:
        notices.append({"id": "n-mints", "severity": "warning", "link": "/admin",
                        "text": f"{plural(failed, 'paid ticket')} still not minted after {int(MINT_GRACE.total_seconds() // 60)} minutes"})
    waiting = db.query(Payout).filter(Payout.status == PayoutStatus.PENDING_APPROVAL).count()
    if waiting:
        notices.append({"id": "n-payout-requests", "severity": "info", "link": "/admin/payouts",
                        "text": f"{plural(waiting, 'payout')} waiting for approval"})
    stuck = db.query(Payout).filter(Payout.status == PayoutStatus.PROCESSING,
                                    Payout.sent_at < _now() - timedelta(minutes=30)).count()
    if stuck:
        notices.append({"id": "n-payouts-stuck", "severity": "warning", "link": "/admin/payouts",
                        "text": f"{plural(stuck, 'payout')} sent over 30 minutes ago with no answer from M-Pesa"})
    queue = len(_payout_queue(db))
    if queue > 5:
        notices.append({"id": "n-payouts", "severity": "info", "link": "/admin/payouts",
                        "text": f"{queue} payouts queued, releasing over the coming days"})
    return notices


# ── Organiser accounts ──────────────────────────────────────────────────────

def _organiser_out(org: Organizer, members: int, events: int) -> dict:
    notes = ["KRA PIN on file" if org.kra_pin else "No KRA PIN yet"]
    if org.payout_method and org.payout_destination:
        notes.append(f"Payouts to {payout_service.describe_destination(org.payout_method, org.payout_destination, org.payout_account, org.payout_label)}")
    else:
        notes.append("No payout details yet")
    notes.append(f"{members} member{'s' if members != 1 else ''} · {events} event{'s' if events != 1 else ''}")
    return {
        "id": org.id,
        "business_name": org.business_name,
        "kra_pin": org.kra_pin or "—",
        "contact_email": org.contact_email or "—",
        "contact_phone": _local_phone(org.contact_phone) if org.contact_phone else "—",
        "status": org.admin_status,
        "registered_at": org.created_at,
        "doc_note": " · ".join(notes),
        "review_reason": org.review_reason,
        "suspended_reason": org.suspended_reason,
    }


@router.get("/organisers")
def list_organisers(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    members = Counter(oid for (oid,) in db.query(OrganizerMember.organizer_id).all())
    events = Counter(oid for (oid,) in db.query(Event.organizer_id).filter(Event.organizer_id.isnot(None)).all())
    orgs = db.query(Organizer).order_by(Organizer.created_at.desc()).all()
    return [_organiser_out(o, members[o.id], events[o.id]) for o in orgs]


@router.post("/organisers/{organiser_id}/review")
def review_organiser(organiser_id: str, body: OrganiserReviewRequest,
                     admin: User = Depends(compliance_access), db: Session = Depends(get_db)):
    org = _get(db, Organizer, organiser_id, "Organiser")
    if body.decision == "rejected" and not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to reject an organiser.")
    org.verification_status = OrganizerVerificationStatus(body.decision)
    org.review_reason = (body.reason or "").strip() or None
    org.reviewed_at = _now()
    _audit(db, admin, f"organiser_{body.decision}", "organiser", org.id, org.review_reason)
    db.commit()
    return {"success": True}


@router.post("/organisers/{organiser_id}/suspend")
def suspend_organiser(organiser_id: str, body: AdminReasonRequest,
                      admin: User = Depends(compliance_access), db: Session = Depends(get_db)):
    org = _get(db, Organizer, organiser_id, "Organiser")
    if org.suspended_at:
        raise HTTPException(status_code=409, detail="This organiser is already suspended.")
    org.suspended_at = _now()
    org.suspended_reason = body.reason.strip()
    _audit(db, admin, "organiser_suspended", "organiser", org.id, org.suspended_reason)
    db.commit()
    return {"success": True}


@router.post("/organisers/{organiser_id}/reinstate")
def reinstate_organiser(organiser_id: str, admin: User = Depends(compliance_access), db: Session = Depends(get_db)):
    org = _get(db, Organizer, organiser_id, "Organiser")
    if not org.suspended_at:
        raise HTTPException(status_code=409, detail="This organiser isn't suspended.")
    org.suspended_at = None
    org.suspended_reason = None
    _audit(db, admin, "organiser_reinstated", "organiser", org.id)
    db.commit()
    return {"success": True}


# ── Event approvals ─────────────────────────────────────────────────────────

def _approval_checks(event: Event) -> list[dict]:
    plain = _strip_tags(event.description_html or event.description or "")
    capacity = event.total_capacity or sum(t.capacity for t in event.tiers)
    return [
        {"label": "Has a cover image", "pass": bool(event.image_mime)},
        {"label": "Has a description", "pass": len(plain.strip()) > 20},
        {"label": "Has at least one ticket tier", "pass": len(event.tiers) > 0},
        {"label": "Capacity is set", "pass": capacity > 0},
        {"label": "Resale cap within policy (≤200%)", "pass": not event.resale_enabled or event.resale_ceiling_multiplier <= 2},
        {"label": "Starts in the future", "pass": bool(event.event_date and event.event_date > _now())},
    ]


def _strip_tags(html: str) -> str:
    out, inside = [], False
    for ch in html:
        if ch == "<":
            inside = True
        elif ch == ">":
            inside = False
        elif not inside:
            out.append(ch)
    return "".join(out)


@router.get("/event-approvals")
def event_approval_queue(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    orgs = {o.id: o.business_name for o in db.query(Organizer).all()}
    events = (
        db.query(Event)
        .filter(Event.review_state == "pending", Event.status == EventStatus.DRAFT)
        .order_by(Event.submitted_for_review_at)
        .all()
    )
    queue = []
    for e in events:
        checks = _approval_checks(e)
        queue.append({
            "id": e.id,
            "title": e.title,
            "venue": e.venue,
            "category": e.category,
            "event_date": e.event_date,
            "image_url": e.image_url,
            "description": e.description_html or e.description,
            "organiser": orgs.get(e.organizer_id),
            "capacity": e.total_capacity or sum(t.capacity for t in e.tiers),
            "tiers": [{"name": t.tier_name, "price": t.price_kes, "capacity": t.capacity} for t in e.tiers],
            "submitted_at": e.submitted_for_review_at,
            "checks": checks,
            "allPassed": all(c["pass"] for c in checks),
        })
    return queue


def _pending_event(db: Session, event_id: str) -> Event:
    event = _get(db, Event, event_id, "Event")
    if event.review_state != "pending":
        raise HTTPException(status_code=409, detail="This event isn't waiting for approval any more.")
    return event


@router.post("/events/{event_id}/approve")
def approve_event(event_id: str, admin: User = Depends(compliance_access), db: Session = Depends(get_db)):
    event = _pending_event(db, event_id)
    org = db.get(Organizer, event.organizer_id) if event.organizer_id else None
    if org and org.suspended_at:
        raise HTTPException(status_code=409, detail=f"{org.business_name} is suspended. Reinstate it first.")
    event.status = EventStatus.PUBLISHED
    event.review_state = "approved"
    event.review_note = None
    _audit(db, admin, "event_approved", "event", event.id, event.title)
    db.commit()
    return {"success": True}


@router.post("/events/{event_id}/reject")
def reject_event(event_id: str, body: AdminReasonRequest,
                 admin: User = Depends(compliance_access), db: Session = Depends(get_db)):
    event = _pending_event(db, event_id)
    event.review_state = "rejected"
    event.review_note = body.reason.strip()
    _audit(db, admin, "event_rejected", "event", event.id, event.review_note)
    db.commit()
    return {"success": True}


# ── Money: costs, fees, payouts ─────────────────────────────────────────────

@router.get("/costs")
def platform_costs(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    gas = settings.COST_GAS_PER_TX_USD
    sms_unit = settings.COST_SMS_PER_MESSAGE_KES
    daraja_unit = settings.COST_DARAJA_PER_TXN_KES

    minted = Counter(eid for (eid,) in db.query(Ticket.event_id).filter(Ticket.nft_token_id.isnot(None)).all())
    resale_txs = Counter()
    for t in db.query(Transfer).all():
        resale_txs[t.event_id] += bool(t.listing_tx_hash) + bool(t.settlement_tx_hash)
    onchain = {eid: minted[eid] + resale_txs[eid] for eid in set(minted) | set(resale_txs)}
    sms_sent = db.query(Notification).filter(Notification.channel == "sms", Notification.sent_at.isnot(None)).count()
    payments = db.query(Payment).filter(Payment.status == PaymentStatus.SUCCESS).count()

    sold = Counter(eid for (eid,) in db.query(Ticket.event_id).filter(Ticket.status.in_(_HELD)).all())
    events = db.query(Event).filter(Event.id.in_(list(sold))).all() if sold else []
    revenue = defaultdict(float)
    for p in _primary_payments(db, [e.id for e in events]):
        revenue[p.ticket.event_id] += float(p.amount_kes)
    per_event = sorted((
        {"event_id": e.id, "event_title": e.title, "tickets_sold": sold[e.id], "revenue_kes": revenue[e.id],
         "gas_cost_usd": round(onchain.get(e.id, 0) * gas, 2), "sms_cost_kes": 0}
        for e in events
    ), key=lambda r: -r["revenue_kes"])

    rpc = (settings.BLOCKCHAIN_RPC_URL or "").lower()
    notes = []
    if settings.COST_INFRA_MONTHLY_USD == 0:
        notes.append("Hosting is on free tiers (Oracle Cloud Always Free, Firebase Spark), so infrastructure costs nothing.")
    if "sepolia" in rpc or "testnet" in rpc:
        notes.append(f"Tickets are minted on a testnet, so the {sum(onchain.values())} on-chain transactions so far cost no real money.")
    if settings.MPESA_ENV != "production":
        notes.append(f"M-Pesa runs on the Daraja sandbox, so the {payments} successful payments incurred no charges.")
    if settings.OTP_DELIVERY_CHANNEL != "sms":
        notes.append("No SMS gateway is connected, so no SMS has been sent or charged.")

    return {
        "infraMonthlyUsd": settings.COST_INFRA_MONTHLY_USD,
        "gasSpendUsd": round(sum(onchain.values()) * gas, 2),
        "onchainTxCount": sum(onchain.values()),
        "smsSpendKes": round(sms_sent * sms_unit),
        "darajaChargesKes": round(payments * daraja_unit),
        "paymentCount": payments,
        "perEvent": per_event,
        "notes": notes,
    }


@router.get("/fees")
def get_fees(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    rows = db.query(FeeSchedule).order_by(FeeSchedule.effective_from).all()
    phones = {u.id: u.phone_number for u in db.query(User).filter(User.id.in_({r.changed_by for r in rows if r.changed_by})).all()}
    history, before = [], DEFAULT_FEES
    for r in rows:
        fees = fees_from_row(r)
        history.append({"id": r.id, "changed_at": r.effective_from, "actor_phone_masked": _mask(phones.get(r.changed_by)),
                        "before": before.as_api(), "after": fees.as_api()})
        before = fees
    return {"current": current_fees(db).as_api(), "history": list(reversed(history))}


@router.put("/fees")
def update_fees(body: FeeConfigUpdate, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    before = current_fees(db)
    row = FeeSchedule(
        platform_fee_percent=body.platformFeePercent, scanning_fee_kes=body.scanningFeeKes,
        min_payout_kes=body.minPayoutKes, seller_escrow_days=body.sellerEscrowDays,
        organiser_escrow_days=body.organiserEscrowDays, effective_from=_now(), changed_by=admin.id,
    )
    db.add(row)
    changes = [
        f"{label} {getattr(before, attr)} → {getattr(body, key)}"
        for label, attr, key in (
            ("platform fee %", "platform_fee_percent", "platformFeePercent"),
            ("scanning fee KES", "scanning_fee_kes", "scanningFeeKes"),
            ("min payout KES", "min_payout_kes", "minPayoutKes"),
            ("seller escrow days", "seller_escrow_days", "sellerEscrowDays"),
            ("organiser escrow days", "organiser_escrow_days", "organiserEscrowDays"),
        )
        if float(getattr(before, attr)) != float(getattr(body, key))
    ]
    _audit(db, admin, "fee_config_updated", "config", "fee_schedule", "; ".join(changes) or "no changes")
    db.commit()
    return {"success": True, "current": current_fees(db).as_api()}


@router.get("/payouts")
def payout_queue(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Earnings still held in escrow, soonest release first."""
    return _payout_queue(db)


def _payout_request_out(p: Payout, orgs: dict[str, str], phones: dict[str, str]) -> dict:
    row = payout_service.serialize(p)
    row["recipient"] = orgs.get(p.organizer_id, "Organiser") if p.organizer_id else _local_phone(phones.get(p.user_id))
    row["sent_at"] = p.sent_at
    return row


@router.get("/payout-requests")
def payout_requests(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Every payout: waiting for approval, in progress, and finished."""
    rows = db.query(Payout).order_by(Payout.created_at.desc()).limit(500).all()
    orgs = {o.id: o.business_name for o in db.query(Organizer).filter(Organizer.id.in_({p.organizer_id for p in rows if p.organizer_id})).all()} if rows else {}
    phones = {u.id: u.phone_number for u in db.query(User).filter(User.id.in_({p.user_id for p in rows})).all()} if rows else {}
    # The B2C account's balance, as of the latest result that reported it.
    balance = None
    for p in db.query(Payout).filter(Payout.status == PayoutStatus.PAID, Payout.channel == "mpesa",
                                     Payout.manual.is_(False)).order_by(Payout.completed_at.desc()).limit(20):
        for item in (((p.result_payload or {}).get("Result") or {}).get("ResultParameters") or {}).get("ResultParameter") or []:
            if isinstance(item, dict) and item.get("Key") == "B2CUtilityAccountAvailableFunds":
                balance = {"kes": item.get("Value"), "as_of": p.completed_at}
                break
        if balance:
            break
    return {
        "automatic": settings.MPESA_PAYOUTS_CONFIGURED,
        "payoutAccountBalance": balance,
        "requests": [_payout_request_out(p, orgs, phones) for p in rows],
    }


def _payout(db: Session, payout_id: str) -> Payout:
    return _get(db, Payout, payout_id, "Payout")


def _payout_action_error(e: payout_service.PayoutError):
    raise HTTPException(status_code=400, detail=str(e))


def _payout_summary(p: Payout) -> str:
    return f"KES {p.amount_kes:,.0f} to {payout_service.describe_destination(p.channel, p.destination, p.account_reference, p.destination_label)}"


@router.post("/payout-requests/{payout_id}/approve")
async def approve_payout(payout_id: str, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    """Send it through M-Pesa now."""
    payout = _payout(db, payout_id)
    try:
        await payout_service.approve(db, payout, admin)
    except payout_service.PayoutError as e:
        _payout_action_error(e)
    _audit(db, admin, "payout_approved", "payout", payout.id, _payout_summary(payout))
    db.commit()
    db.refresh(payout)
    return payout_service.serialize(payout)


@router.post("/payout-requests/{payout_id}/reject")
def reject_payout(payout_id: str, body: AdminReasonRequest, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    payout = _payout(db, payout_id)
    try:
        payout_service.reject(db, payout, admin, body.reason.strip())
    except payout_service.PayoutError as e:
        _payout_action_error(e)
    _audit(db, admin, "payout_rejected", "payout", payout.id, f"{_payout_summary(payout)}: {body.reason.strip()}")
    db.commit()
    return payout_service.serialize(payout)


@router.post("/payout-requests/{payout_id}/mark-paid")
def mark_payout_paid(payout_id: str, body: PayoutReceiptRequest, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    """Record a payout the admin made by hand, or confirmed in the M-Pesa
    business portal, with its M-Pesa receipt."""
    payout = _payout(db, payout_id)
    try:
        payout_service.mark_paid_manually(db, payout, admin, body.receipt)
    except payout_service.PayoutError as e:
        _payout_action_error(e)
    _audit(db, admin, "payout_marked_paid", "payout", payout.id, f"{_payout_summary(payout)}, M-Pesa {body.receipt}")
    db.commit()
    return payout_service.serialize(payout)


@router.post("/payout-requests/{payout_id}/mark-failed")
def mark_payout_failed(payout_id: str, body: AdminReasonRequest, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    """For a payout with no answer that the admin has confirmed never
    arrived: the money goes back to the recipient's balance."""
    payout = _payout(db, payout_id)
    try:
        payout_service.mark_failed(db, payout, admin, body.reason.strip())
    except payout_service.PayoutError as e:
        _payout_action_error(e)
    _audit(db, admin, "payout_marked_failed", "payout", payout.id, f"{_payout_summary(payout)}: {body.reason.strip()}")
    db.commit()
    return payout_service.serialize(payout)


@router.post("/payout-requests/{payout_id}/check-status")
async def check_payout_status(payout_id: str, admin: User = Depends(finance_access), db: Session = Depends(get_db)):
    """Ask M-Pesa what happened; its answer settles the payout if it's clear."""
    payout = _payout(db, payout_id)
    try:
        await payout_service.check_status(db, payout)
    except payout_service.PayoutError as e:
        _payout_action_error(e)
    _audit(db, admin, "payout_status_checked", "payout", payout.id)
    db.commit()
    return payout_service.serialize(payout)


# ── Integrity ───────────────────────────────────────────────────────────────

@router.get("/resale-compliance")
def resale_compliance(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    rejected = Counter(
        eid for (eid,) in db.query(AuditLog.target_id).filter(AuditLog.action_type == "resale_rejected_above_cap").all()
    )
    listings = Counter(eid for (eid,) in db.query(Transfer.event_id).filter(Transfer.status.in_(_OPEN_LISTINGS)).all())
    ids = set(rejected) | set(listings)
    events = db.query(Event).filter(Event.id.in_(list(ids))).all() if ids else []
    return {
        "rejectedAboveCapAttempts": sum(rejected.values()),
        # Cap changes never pause existing listings (minted caps are fixed on-chain).
        "listingsPausedByCapChange": 0,
        "byEvent": sorted((
            {"event_id": e.id, "event_title": e.title, "rejected": rejected[e.id], "listings": listings[e.id],
             "cap_percent": round(e.resale_ceiling_multiplier * 100)}
            for e in events
        ), key=lambda r: (-r["rejected"], -r["listings"])),
    }


@router.get("/fraud-signals")
def fraud_signals(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    return _fraud_signals(db)


def _audit_query(db: Session, q: str):
    query = db.query(AuditLog).filter(AuditLog.action_type != "sign_in")
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(AuditLog.action_type.ilike(like), AuditLog.target_id.ilike(like),
                                 AuditLog.target_type.ilike(like), AuditLog.details.ilike(like)))
    return query.order_by(AuditLog.created_at.desc())


def _audit_rows(db: Session, logs: list[AuditLog]) -> list[dict]:
    actors = {log.actor_id for log in logs if log.actor_id}
    phones = {u.id: u.phone_number for u in db.query(User).filter(User.id.in_(actors)).all()} if actors else {}
    return [{
        "id": log.id, "at": log.created_at, "actor_phone_masked": _mask(phones.get(log.actor_id)) if log.actor_id else None,
        "action": log.action_type, "target_type": log.target_type, "target_id": log.target_id, "reason": log.details,
    } for log in logs]


@router.get("/audit-log")
def audit_log(q: str = "", _a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Every admin and organiser action, newest first. Sign-ins are left
    out: they're each user's own (Profile → Activity) and would bury the rest."""
    return _audit_rows(db, _audit_query(db, q).limit(300).all())


@router.get("/audit-log/export")
def export_audit_log(q: str = "", _a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["at_utc", "actor", "action", "target_type", "target_id", "detail"])
    for r in _audit_rows(db, _audit_query(db, q).limit(10_000).all()):
        writer.writerow([r["at"].isoformat() if r["at"] else "", r["actor_phone_masked"] or "", r["action"],
                         r["target_type"] or "", r["target_id"] or "", r["reason"] or ""])
    name = f"chaintix-audit-log-{_now():%Y%m%d}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ── Communication ───────────────────────────────────────────────────────────

CHANNELS = {
    "in_app": {"available": True, "reason": None},
    "sms": {"available": False, "reason": "No SMS gateway is connected to ChainTix."},
    "push": {"available": False, "reason": "Push notifications aren't built yet."},
}


def _audience_ids(db: Session, audience: str) -> set[str] | None:
    """User ids in an audience; None means everyone."""
    if audience == "all":
        return None
    members = {uid for (uid,) in db.query(OrganizerMember.account_id).all()}
    if audience == "organisers":
        return members
    if audience == "gate_staff":
        return {uid for (uid,) in db.query(GateScanner.account_id).filter(GateScanner.account_id.isnot(None)).all()}
    everyone = {uid for (uid,) in db.query(User.id).filter(User.is_active.is_(True)).all()}
    return everyone - members  # attendees


def _broadcast_out(b: Broadcast, now: datetime) -> dict:
    scheduled = bool(b.scheduled_for and b.scheduled_for > now)
    return {
        "id": b.id, "message": b.message, "channels": b.channels, "audience": b.audience,
        "audience_size": b.audience_size, "status": "scheduled" if scheduled else "sent",
        "scheduled_for": b.scheduled_for, "sent_at": None if scheduled else (b.scheduled_for or b.created_at),
        "delivery": {"in_app": {"sent": b.audience_size, "delivered": b.audience_size}},
    }


@router.get("/broadcast-channels")
def broadcast_channels(_a: User = Depends(require_platform_admin)):
    return CHANNELS


@router.get("/broadcasts")
def list_broadcasts(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    now = _now()
    rows = db.query(Broadcast).order_by(Broadcast.created_at.desc()).limit(100).all()
    return [_broadcast_out(b, now) for b in rows]


@router.post("/broadcasts", status_code=status.HTTP_201_CREATED)
def send_broadcast(body: BroadcastCreate, admin: User = Depends(support_access), db: Session = Depends(get_db)):
    for ch in body.channels:
        if ch not in CHANNELS:
            raise HTTPException(status_code=400, detail=f"Unknown channel: {ch}")
        if not CHANNELS[ch]["available"]:
            raise HTTPException(status_code=400, detail=CHANNELS[ch]["reason"])
    scheduled = body.scheduledFor
    if scheduled and scheduled.tzinfo:
        scheduled = scheduled.astimezone(timezone.utc).replace(tzinfo=None)
    if scheduled and scheduled <= _now():
        scheduled = None  # "later" that's already passed: send now
    ids = _audience_ids(db, body.audience)
    size = db.query(User).filter(User.is_active.is_(True)).count() if ids is None else len(ids)
    b = Broadcast(message=body.message.strip(), channels=sorted(set(body.channels)), audience=body.audience,
                  audience_size=size, scheduled_for=scheduled, created_by=admin.id)
    db.add(b)
    db.flush()
    _audit(db, admin, "broadcast_scheduled" if scheduled else "broadcast_sent", "broadcast", b.id,
           f"to {body.audience}: {b.message[:120]}")
    db.commit()
    return _broadcast_out(b, _now())


@public_router.get("/announcements")
def announcements(db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    """Broadcasts the viewer should see in the site's banner: from the last
    two weeks, already due, and addressed to everyone or to a group the
    viewer is in."""
    now = _now()
    audiences = {"all"}
    if user:
        is_member = db.query(OrganizerMember.id).filter(OrganizerMember.account_id == user.id).first() is not None
        audiences.add("organisers" if is_member else "attendees")
        if db.query(GateScanner.id).filter(GateScanner.account_id == user.id).first():
            audiences.add("gate_staff")
    rows = (
        db.query(Broadcast)
        .filter(Broadcast.audience.in_(audiences), Broadcast.created_at >= now - timedelta(days=14),
                or_(Broadcast.scheduled_for.is_(None), Broadcast.scheduled_for <= now))
        .order_by(Broadcast.created_at.desc())
        .limit(3)
        .all()
    )
    return [{"id": b.id, "message": b.message, "at": b.scheduled_for or b.created_at} for b in rows]


# ── Admin users ─────────────────────────────────────────────────────────────

def _admin_out(u: User, me: User) -> dict:
    return {"id": u.id, "name": u.display_name or _local_phone(u.phone_number), "phone": _local_phone(u.phone_number),
            "role": admin_role(u), "status": "active", "invited_at": u.platform_admin_since or u.created_at,
            "is_you": u.id == me.id}


@router.get("/admins")
def list_admins(admin: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.is_platform_admin.is_(True)).order_by(User.created_at).all()
    invites = db.query(AdminInvite).order_by(AdminInvite.created_at).all()
    return [_admin_out(u, admin) for u in users] + [
        {"id": f"invite:{i.id}", "name": i.name, "phone": _local_phone(i.phone_number), "role": i.role,
         "status": "invited", "invited_at": i.created_at, "is_you": False}
        for i in invites
    ]


@router.post("/admins", status_code=status.HTTP_201_CREATED)
def invite_admin(body: AdminInviteRequest, admin: User = Depends(super_access), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone_number == body.phone).first()
    if user:
        if user.is_platform_admin:
            raise HTTPException(status_code=409, detail="That number is already a platform admin.")
        user.is_platform_admin = True
        user.platform_admin_role = body.role
        user.platform_admin_since = _now()
        if not user.display_name:
            user.display_name = body.name.strip()
        _audit(db, admin, "admin_user_added", "user", user.id, f"role={body.role}")
        db.commit()
        return _admin_out(user, admin)
    if db.query(AdminInvite).filter(AdminInvite.phone_number == body.phone).first():
        raise HTTPException(status_code=409, detail="That number has already been invited.")
    invite = AdminInvite(phone_number=body.phone, name=body.name.strip(), role=body.role, invited_by=admin.id)
    db.add(invite)
    db.flush()
    _audit(db, admin, "admin_user_invited", "admin_invite", invite.id, f"role={body.role}")
    db.commit()
    return {"id": f"invite:{invite.id}", "name": invite.name, "phone": _local_phone(invite.phone_number),
            "role": invite.role, "status": "invited", "invited_at": invite.created_at, "is_you": False}


@router.delete("/admins/{admin_id}")
def remove_admin(admin_id: str, admin: User = Depends(super_access), db: Session = Depends(get_db)):
    if admin_id.startswith("invite:"):
        invite = _get(db, AdminInvite, admin_id.removeprefix("invite:"), "Invite")
        db.delete(invite)
        _audit(db, admin, "admin_invite_cancelled", "admin_invite", invite.id)
        db.commit()
        return {"success": True}
    user = _get(db, User, admin_id, "Admin")
    if not user.is_platform_admin:
        raise HTTPException(status_code=404, detail="Admin not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You can't remove yourself. Ask another super admin.")
    if admin_role(user) == "super_admin":
        supers = [u for u in db.query(User).filter(User.is_platform_admin.is_(True)).all() if admin_role(u) == "super_admin"]
        if len(supers) <= 1:
            raise HTTPException(status_code=400, detail="ChainTix needs at least one super admin.")
    user.is_platform_admin = False
    user.platform_admin_role = None
    user.platform_admin_since = None
    _audit(db, admin, "admin_user_removed", "user", user.id)
    db.commit()
    return {"success": True}


# ── Feature flags ───────────────────────────────────────────────────────────

def _flag_out(db: Session, key: str) -> dict:
    spec = FLAG_SPECS[key]
    enabled, rollout = flag_state(db, key)
    return {"id": key, "key": key, "label": spec.label, "description": spec.description,
            "enabled": enabled, "rollout_percent": rollout if enabled else 0, "supports_rollout": spec.supports_rollout}


def _save_flag(db: Session, admin: User, key: str, enabled: bool, rollout: int) -> FeatureFlag:
    if key not in FLAG_SPECS:
        raise HTTPException(status_code=404, detail="Flag not found")
    row = db.get(FeatureFlag, key) or FeatureFlag(key=key)
    row.enabled, row.rollout_percent = enabled, rollout
    row.updated_by, row.updated_at = admin.id, _now()
    db.add(row)
    return row


@router.get("/feature-flags")
def list_flags(_a: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    return [_flag_out(db, f.key) for f in FLAGS]


@router.post("/feature-flags/{key}/toggle")
def toggle_flag(key: str, admin: User = Depends(super_access), db: Session = Depends(get_db)):
    if key not in FLAG_SPECS:
        raise HTTPException(status_code=404, detail="Flag not found")
    enabled, rollout = flag_state(db, key)
    now_on = not enabled
    _save_flag(db, admin, key, now_on, (rollout or 100) if now_on else 0)
    _audit(db, admin, "feature_flag_enabled" if now_on else "feature_flag_disabled", "feature_flag", key)
    db.commit()
    return _flag_out(db, key)


@router.put("/feature-flags/{key}/rollout")
def set_flag_rollout(key: str, body: FeatureFlagRollout, admin: User = Depends(super_access), db: Session = Depends(get_db)):
    if key not in FLAG_SPECS:
        raise HTTPException(status_code=404, detail="Flag not found")
    if not FLAG_SPECS[key].supports_rollout and body.rollout_percent not in (0, 100):
        raise HTTPException(status_code=400, detail="This flag is either on or off for everyone.")
    _save_flag(db, admin, key, body.rollout_percent > 0, body.rollout_percent)
    _audit(db, admin, "feature_flag_rollout", "feature_flag", key, f"{body.rollout_percent}%")
    db.commit()
    return _flag_out(db, key)
