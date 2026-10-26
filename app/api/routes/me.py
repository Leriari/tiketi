"""
The signed-in user's own account: one profile across every role they hold
(attendee, seller, organiser member, platform admin), their activity log,
and "sign out everywhere".

The activity log is assembled from the real records each event already
leaves behind — payments, tickets, resale transfers, wallet payouts,
organisation memberships — plus the audit log for things that leave no
other trace (sign-ins, organiser actions). Nothing is stored twice.
"""
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.resale import _compute_wallet
from app.core.dependencies import get_current_user
from app.db.session import get_db
from app.models.models import (
    AuditLog, Event, OrganizerMember, Payment, PaymentStatus, Ticket, TicketStatus, Transfer,
    TransferStatus, User, WalletTransaction, WalletTransactionType,
)
from app.services import auth_service

router = APIRouter(prefix="/me", tags=["My account"])

_EXPORT_LABELS = {
    "ticket_sales": "ticket sales", "attendance": "attendance", "royalty_ledger": "royalty ledger", "payouts": "payouts",
}


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ProfileUpdate(BaseModel):
    """Either or both. display_name is the person's full name — it's on
    their receipts and shown to organisers on guest lists."""
    display_name: Optional[str] = None
    email: Optional[str] = None

    @field_validator("display_name")
    @classmethod
    def sensible_name(cls, v):
        if v is None:
            return v
        v = " ".join(v.split())
        if not 1 <= len(v) <= 60:
            raise ValueError("Your name must be 1-60 characters.")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v):
        if v is None:
            return v
        v = v.strip().lower()
        if len(v) > 255 or not _EMAIL.match(v):
            raise ValueError("Enter a valid email address, e.g. name@example.com.")
        return v


def _naive(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


def _iso(dt: datetime | None) -> str | None:
    # Fixed width (always with microseconds), so these strings sort and
    # compare correctly — the activity log pages by comparing them.
    return _naive(dt).isoformat(timespec="microseconds") if dt else None


def _parse_details(details: str | None) -> dict:
    """key=value pairs joined by "; ". The user agent is always written
    last and can itself contain "; ", so it takes the rest of the string."""
    text = details or ""
    head, sep, agent = text.partition("agent=")
    out = {}
    for part in head.split("; "):
        key, _, value = part.partition("=")
        if value:
            out[key] = value
    if sep:
        out["agent"] = agent
    return out


def _device(agent: str | None) -> str | None:
    """A short human label from a user-agent string ("Chrome on Windows")."""
    if not agent:
        return None
    a = agent.lower()
    browser = next((name for key, name in (("edg/", "Edge"), ("opr/", "Opera"), ("chrome/", "Chrome"),
                                          ("firefox/", "Firefox"), ("safari/", "Safari"), ("python", "API client"),
                                          ("testclient", "Test client")) if key in a), "a browser")
    system = next((name for key, name in (("android", "Android"), ("iphone", "iPhone"), ("ipad", "iPad"),
                                         ("windows", "Windows"), ("mac os", "macOS"), ("linux", "Linux")) if key in a), None)
    return f"{browser} on {system}" if system else browser


# ── Profile ─────────────────────────────────────────────────────────────────

def _last_sign_in(db: Session, user: User) -> dict | None:
    log = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == user.id, AuditLog.action_type == "sign_in")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    if not log:
        return None
    d = _parse_details(log.details)
    return {"at": _iso(log.created_at), "method": d.get("method"), "device": _device(d.get("agent"))}


def _profile(db: Session, user: User) -> dict:
    now = datetime.utcnow()
    tickets = db.query(Ticket).filter(Ticket.owner_id == user.id).all()
    held = [t for t in tickets if t.status in (TicketStatus.ACTIVE, TicketStatus.RESALE)]
    upcoming = [t for t in held if t.event and t.event.event_date > now]

    listings = db.query(Transfer).filter(Transfer.seller_id == user.id).all()
    wallet = _compute_wallet(db, user.id)

    memberships = db.query(OrganizerMember).filter(OrganizerMember.account_id == user.id).all()
    organisations = []
    for m in memberships:
        org = m.organizer
        organisations.append({
            "id": org.id,
            "business_name": org.business_name,
            "role": m.role.value,
            "verification_status": org.verification_status.value,
            "events": db.query(Event).filter(Event.organizer_id == org.id).count(),
            "member_since": _iso(m.created_at),
        })

    methods = ["Phone"]
    if user.google_sub:
        methods.append("Google")

    return {
        "user": {
            "id": user.id,
            "phone_number": user.phone_number,
            "display_name": user.display_name,
            "email": user.email,
            "email_verified": bool(user.email_verified),
            # Name and email are asked for once, at sign-up (the welcome step).
            "profile_complete": bool(user.display_name and user.email),
            "google_linked": bool(user.google_sub),
            "phone_verified": user.phone_verified is not False,
            "member_since": _iso(user.created_at),
        },
        "security": {"sign_in_methods": methods, "last_sign_in": _last_sign_in(db, user)},
        "attendee": {
            "tickets_held": len(held),
            "upcoming_events": len({t.event_id for t in upcoming}),
            "events_attended": len({t.event_id for t in tickets if t.status == TicketStatus.USED}),
        },
        "seller": {
            "active_listings": sum(1 for t in listings if t.status in (TransferStatus.LISTED, TransferStatus.PAUSED, TransferStatus.PENDING_PAYMENT)),
            "tickets_sold": sum(1 for t in listings if t.status == TransferStatus.COMPLETED),
            "available_kes": wallet["available"],
            "pending_kes": wallet["pending"],
        },
        "organisations": organisations,
        "platform_admin": bool(user.is_platform_admin),
    }


@router.get("/profile")
def get_profile(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _profile(db, current_user)


@router.patch("/profile")
def update_profile(body: ProfileUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if body.display_name is None and body.email is None:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    if body.display_name is not None:
        current_user.display_name = body.display_name
    if body.email is not None and body.email != (current_user.email or "").lower():
        taken = db.query(User.id).filter(func.lower(User.email) == body.email, User.id != current_user.id).first()
        if taken:
            raise HTTPException(status_code=409, detail="Another ChainTix account already uses that email address.")
        current_user.email = body.email
        current_user.email_verified = False  # typed in, not confirmed by Google
    db.commit()
    return _profile(db, current_user)


# ── Sessions ────────────────────────────────────────────────────────────────

@router.post("/sign-out-everywhere")
def sign_out_everywhere(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Ends every existing session for this account, then hands this device
    a fresh token so the person doing it stays signed in here."""
    current_user.session_version = (current_user.session_version or 0) + 1
    agent = (request.headers.get("user-agent") or "")[:160]
    db.add(AuditLog(actor_id=current_user.id, action_type="sign_out_everywhere", target_id=current_user.id,
                    target_type="user", details=f"agent={agent}" if agent else None))
    db.commit()
    return {
        "access_token": auth_service.create_access_token(current_user.id, current_user.phone_number, current_user.session_version),
        "token_type": "bearer",
    }


# ── Activity log ────────────────────────────────────────────────────────────

def _entry(kind: str, category: str, at, title: str, detail: str | None = None, amount_kes=None, link: str | None = None, key: str = ""):
    return {"id": f"{kind}:{key}", "kind": kind, "category": category, "at": _iso(at), "title": title,
            "detail": detail, "amount_kes": amount_kes, "link": link}


def _who(user: User | None) -> str:
    if not user:
        return "someone"
    if user.display_name:
        return user.display_name
    phone = user.phone_number or ""
    return "0" + phone[3:] if phone.startswith("254") else phone


def _activity(db: Session, user: User) -> list[dict]:
    items = [_entry("account_created", "security", user.created_at, "Account created", key=user.id)]

    # Audit log: sign-ins and organiser actions.
    for log in db.query(AuditLog).filter(AuditLog.actor_id == user.id).all():
        d = _parse_details(log.details)
        if log.action_type == "sign_in":
            device = _device(d.get("agent"))
            detail = " · ".join(x for x in (f"with {d['method']}" if d.get("method") else None, device) if x) or None
            items.append(_entry("sign_in", "security", log.created_at, "Signed in", detail, key=log.id))
        elif log.action_type == "sign_out_everywhere":
            items.append(_entry("sign_out_everywhere", "security", log.created_at, "Signed out of all other devices", key=log.id))
        elif log.action_type == "complimentary_ticket":
            items.append(_entry("comp_sent", "organiser", log.created_at, "Sent a complimentary ticket", log.details, key=log.id))
        elif log.action_type == "manual_override":
            items.append(_entry("manual_override", "organiser", log.created_at, "Admitted a ticket manually", log.details, key=log.id))
        elif log.action_type == "export":
            export_type = (log.details or "").partition(":")[0]
            items.append(_entry("export", "organiser", log.created_at, f"Exported {_EXPORT_LABELS.get(export_type, export_type)}", key=log.id))
        elif log.action_type == "ticket_transferred":
            ticket = db.get(Ticket, log.target_id)
            to = db.get(User, (log.details or "")[3:])
            items.append(_entry("gift_sent", "ticket", log.created_at,
                                f"Gave your ticket for {ticket.event.title if ticket and ticket.event else 'an event'} to {_who(to)}",
                                key=log.id))
        elif log.action_type.startswith("resale_rejected"):
            price = d.get("price_kes")
            items.append(_entry("listing_refused", "resale", log.created_at, "Listing price refused",
                                f"KES {price} is above the organiser's limit" if price else None, key=log.id))

    # Tickets others gave you.
    for log in db.query(AuditLog).filter(AuditLog.action_type == "ticket_transferred", AuditLog.details == f"to={user.id}").all():
        ticket = db.get(Ticket, log.target_id)
        sender = db.get(User, log.actor_id) if log.actor_id else None
        items.append(_entry("gift_received", "ticket", log.created_at,
                            f"Received a ticket for {ticket.event.title if ticket and ticket.event else 'an event'} from {_who(sender)}",
                            link=f"/tickets/{log.target_id}", key=log.id))

    # Payments: primary purchases and resale purchases.
    resale_payment_ids = {t.payment_id: t for t in db.query(Transfer).filter(Transfer.buyer_id == user.id).all() if t.payment_id}
    for p in db.query(Payment).filter(Payment.user_id == user.id).all():
        event = p.ticket.event if p.ticket else None
        title_event = event.title if event else "an event"
        if p.status == PaymentStatus.SUCCESS:
            if p.id in resale_payment_ids:
                items.append(_entry("resale_bought", "resale", p.confirmed_at or p.initiated_at, f"Bought a resale ticket for {title_event}",
                                    f"M-Pesa {p.mpesa_receipt_number}" if p.mpesa_receipt_number else None, -p.amount_kes, "/tickets", p.id))
            else:
                qty = p.quantity or 1
                items.append(_entry("purchase", "purchase", p.confirmed_at or p.initiated_at,
                                    f"Bought {qty} ticket{'s' if qty > 1 else ''} for {title_event}",
                                    f"M-Pesa {p.mpesa_receipt_number}" if p.mpesa_receipt_number else None, -p.amount_kes, "/tickets", p.id))
        elif p.status in (PaymentStatus.FAILED, PaymentStatus.TIMEOUT):
            items.append(_entry("payment_failed", "purchase", p.initiated_at, f"Payment didn't complete for {title_event}",
                                p.failure_reason, None, None, p.id))

    # Resale as seller.
    for t in db.query(Transfer).filter(Transfer.seller_id == user.id).all():
        title_event = t.event.title if t.event else "an event"
        items.append(_entry("listed", "resale", t.created_at, f"Listed a ticket for {title_event}", f"Asking KES {t.asking_price_kes:,.0f}",
                            link="/seller/listings", key=t.id))
        if t.status == TransferStatus.COMPLETED and t.transferred_at:
            items.append(_entry("sold", "resale", t.transferred_at, f"Sold your ticket for {title_event}",
                                "Payout after fees and royalty", t.seller_payout_kes, "/seller/wallet", t.id))
        elif t.status == TransferStatus.CANCELLED and t.cancelled_at:
            items.append(_entry("listing_cancelled", "resale", t.cancelled_at, f"Cancelled your listing for {title_event}", key=t.id))

    # Payouts.
    for w in db.query(WalletTransaction).filter(WalletTransaction.user_id == user.id,
                                                WalletTransaction.type == WalletTransactionType.WITHDRAWAL).all():
        items.append(_entry("withdrawal", "payout", w.created_at, "Withdrew to M-Pesa", w.description, -abs(w.amount_kes), "/seller/payouts", w.id))

    # Tickets: complimentary received, admissions.
    for t in db.query(Ticket).filter(Ticket.owner_id == user.id).all():
        title_event = t.event.title if t.event else "an event"
        if t.is_complimentary:
            items.append(_entry("comp_received", "ticket", t.created_at, f"Received a complimentary ticket for {title_event}",
                                t.complimentary_note, link=f"/tickets/{t.id}", key=t.id))
        if t.used_at:
            items.append(_entry("admitted", "ticket", t.used_at, f"Admitted at {title_event}", key=t.id))

    # Organisation memberships.
    for m in db.query(OrganizerMember).filter(OrganizerMember.account_id == user.id).all():
        items.append(_entry("joined_org", "organiser", m.created_at,
                            f"Joined {m.organizer.business_name} as {'Owner' if m.role.value == 'owner' else 'Staff'}",
                            link="/organiser", key=m.id))

    items = [i for i in items if i["at"]]
    # Newest first. The Windows clock ticks every ~15 ms, so an account's
    # first sign-in can share its creation timestamp; "Account created"
    # always sorts as the older of a tie.
    items.sort(key=lambda i: (i["at"], i["kind"] != "account_created"), reverse=True)
    return items


@router.get("/activity")
def get_activity(
    limit: int = 50,
    before: str | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The user's own account history, newest first. Page with `before`
    (the `at` of the last item you have); filter with `category`
    (security | purchase | resale | ticket | payout | organiser)."""
    if not 1 <= limit <= 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    items = _activity(db, current_user)
    if category:
        items = [i for i in items if i["category"] == category]
    if before:
        # The cursor comes back as the client saw it, with the "Z" that
        # UTCJSONResponse adds; the items here don't have it yet.
        before = before.removesuffix("Z")
        items = [i for i in items if i["at"] < before]
    page = items[:limit]
    return {"items": page, "has_more": len(items) > limit}
