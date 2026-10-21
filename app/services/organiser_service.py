"""
Event create/edit and serialisation for the Organiser Console.

The console's Event Management form sends one payload for both creating
and editing (tiers, gates, resale settings, …) and reads events back in
the shape its pages were built against. Both directions live here so
POST /events/ and PATCH /events/{id} (app/api/routes/events.py) and the
organisation-scoped reads (app/api/routes/organiser_console.py) can't
drift apart.
"""
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.models import Event, EventStatus, EventTier, TierStatus, Ticket, Organizer, User
from app.schemas.schemas import EventDetailsIn, TierIn, EVENT_STATUS_FROM_UI, EVENT_STATUS_TO_UI
from app.services import event_images

settings = get_settings()

DEFAULT_RESALE_MULTIPLIER = 1.2
DEFAULT_ROYALTY_PERCENT = 10.0


def _bad(detail: str):
    raise HTTPException(status_code=400, detail=detail)


def _naive_utc(value: datetime | None) -> datetime | None:
    """Store datetimes naive-UTC, like every other DateTime column here
    (SQLite round-trips them naive)."""
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def ui_status(event: Event) -> str:
    return EVENT_STATUS_TO_UI.get(event.status.value, event.status.value)


def resale_multiplier(event: Event) -> float:
    return event.resale_ceiling_multiplier


def _apply_image(event: Event, body: EventDetailsIn) -> None:
    """image_data_url is only acted on when the form sends it: a data: URL
    is a new upload, null/"" removes the image, and anything else (e.g. the
    event's own image URL echoed back) leaves the current image alone."""
    if "image_data_url" not in body.model_fields_set:
        return
    value = (body.image_data_url or "").strip()
    if not value:
        event.image_data = None
        event.image_mime = None
        event.image_updated_at = None
    elif value.startswith("data:"):
        event.image_data, event.image_mime = event_images.process_upload(value)
        event.image_updated_at = datetime.utcnow()


def apply_event_details(db: Session, event: Event, body: EventDetailsIn, *, creating: bool) -> None:
    """
    Copy the form onto `event` (and its tiers), validating as it goes.
    Drafts may be incomplete; anything else must be sellable. Raises a 400
    with a plain sentence the console shows as-is.
    """
    target_status = body.status or (ui_status(event) if not creating else "live")
    is_draft = target_status == "draft"

    for field in ("title", "category", "description", "description_html", "artists"):
        value = getattr(body, field)
        if value is not None:
            setattr(event, field, value)
    _apply_image(event, body)
    if body.venue is not None:
        event.venue = body.venue.strip()
    if body.event_date is not None:
        event.event_date = _naive_utc(body.event_date)
    if "ends_at" in body.model_fields_set:
        event.ends_at = _naive_utc(body.ends_at)
    if body.resale_enabled is not None:
        event.resale_enabled = body.resale_enabled
    if body.resale_window_open_days is not None:
        if body.resale_window_open_days < 0:
            _bad("Resale can't open a negative number of days after purchase.")
        event.resale_window_open_days = body.resale_window_open_days
    if body.resale_window_close_hours is not None:
        if body.resale_window_close_hours < 0:
            _bad("Resale can't close a negative number of hours before the event.")
        event.resale_window_close_hours = body.resale_window_close_hours

    if not (event.title or "").strip():
        _bad("Add a title before saving.")
    if event.event_date is None:
        _bad("Add a start date before saving.")
    if event.venue is None:
        event.venue = ""
    if event.ends_at and event.ends_at <= event.event_date:
        _bad("The end time must be after the start time.")

    # ── Gates ────────────────────────────────────────────────────────────
    if body.gates is not None:
        gates, seen = [], set()
        for g in body.gates:
            name = g.name.strip()
            if not name:
                continue
            if name.lower() in seen:
                _bad(f"Two gates are both called \"{name}\" — gate names must be unique.")
            seen.add(name.lower())
            gates.append({"id": g.id or str(uuid.uuid4()), "name": name})
        event.gates = gates
    if not event.gates:
        event.gates = [{"id": str(uuid.uuid4()), "name": "Gate A"}]

    # ── Resale terms (apply to every tier) ───────────────────────────────
    multiplier = body.max_resale_multiplier if body.max_resale_multiplier is not None else (
        DEFAULT_RESALE_MULTIPLIER if creating else resale_multiplier(event)
    )
    royalty = body.resale_royalty_percent if body.resale_royalty_percent is not None else (
        DEFAULT_ROYALTY_PERCENT if creating else event.resale_royalty_percent
    )
    if not 1.0 <= multiplier <= 2.0:
        _bad("The maximum resale price must be between 100% and 200% of face value.")
    if not 0 <= royalty <= 30:
        _bad("The organiser royalty must be between 0% and 30%.")

    # ── Tiers ────────────────────────────────────────────────────────────
    if body.tiers is not None:
        existing = {t.id: t for t in event.tiers}
        kept_ids = set()
        for order, tin in enumerate(body.tiers):
            name = tin.name.strip()
            if not name:
                if is_draft:
                    continue
                _bad("Every ticket tier needs a name.")
            tier = existing.get(tin.id) if tin.id else None
            if tier is None:
                tier = EventTier(event=event, tickets_sold=0, status=TierStatus.ACTIVE)
                db.add(tier)
            else:
                kept_ids.add(tier.id)
            if tin.capacity < (tier.tickets_sold or 0):
                _bad(f"\"{name}\" has already sold {tier.tickets_sold} tickets — its quantity can't go below that.")
            tier.tier_name = name
            tier.description = tin.description
            tier.price_kes = float(tin.price)
            tier.capacity = int(tin.capacity)
            tier.per_order_max = tin.perOrderMax
            tier.visibility = tin.visibility
            tier.sales_start = _naive_utc(tin.salesStart)
            tier.sales_end = _naive_utc(tin.salesEnd)
            tier.sort_order = order
            tier.resale_floor_price_kes = tier.price_kes
            tier.resale_ceiling_price_kes = round(tier.price_kes * multiplier, 2)
            tier.organizer_royalty_percent = royalty

        for tier_id, tier in existing.items():
            if tier_id in kept_ids:
                continue
            has_tickets = db.query(Ticket.id).filter(Ticket.tier_id == tier_id).first() is not None
            if has_tickets:
                _bad(f"\"{tier.tier_name}\" already has tickets, so it can't be removed. Set it to hidden instead.")
            event.tiers.remove(tier)
            db.delete(tier)
        db.flush()
        db.refresh(event)

    for tier in event.tiers:
        tier.resale_floor_price_kes = tier.price_kes
        tier.resale_ceiling_price_kes = round(tier.price_kes * multiplier, 2)
        tier.organizer_royalty_percent = royalty

    tier_capacity = sum(t.capacity for t in event.tiers)
    if body.total_capacity is not None:
        event.total_capacity = body.total_capacity
    elif body.tiers is not None or creating:
        event.total_capacity = tier_capacity
    if (event.total_capacity or 0) < (event.tickets_sold or 0):
        _bad(f"This event has already sold {event.tickets_sold} tickets — capacity can't go below that.")

    # ── Status, and what "not a draft" requires ──────────────────────────
    if not is_draft:
        if not event.venue:
            _bad("Add a venue before publishing.")
        sellable = [t for t in event.tiers if t.capacity > 0]
        if not sellable:
            _bad("Add at least one ticket tier with a name, price, and quantity before publishing.")
        for t in event.tiers:
            if (t.visibility or "public") == "public" and t.price_kes <= 0:
                _bad(f"\"{t.tier_name}\" is free and public. M-Pesa can't charge KES 0 — give it a price, "
                     "or make it hidden and hand those tickets out as complimentary tickets.")
    event.status = EventStatus(EVENT_STATUS_FROM_UI[target_status])


def tier_out(tier: EventTier, multiplier: float) -> dict:
    return {
        "id": tier.id,
        "name": tier.tier_name,
        "description": tier.description or "",
        "price": tier.price_kes,
        "capacity": tier.capacity,
        "tickets_sold": tier.tickets_sold,
        "tickets_remaining": tier.tickets_remaining,
        "perOrderMax": tier.per_order_max or 4,
        "visibility": tier.visibility or "public",
        "salesStart": tier.sales_start.isoformat() if tier.sales_start else "",
        "salesEnd": tier.sales_end.isoformat() if tier.sales_end else "",
        "resale_floor_kes": tier.resale_floor_price_kes,
        "resale_ceiling_kes": round(tier.price_kes * multiplier),
    }


def event_out(event: Event, organisation: Organizer | None = None) -> dict:
    """An event in the shape every Organiser Console page reads (the same
    keys the mock backend's eventSummary returns)."""
    multiplier = resale_multiplier(event)
    remaining = event.total_capacity - event.tickets_sold
    fraction_left = remaining / event.total_capacity if event.total_capacity else 0
    status = ui_status(event)
    if status == "sold_out" or remaining <= 0:
        availability = "sold_out"
    elif fraction_left <= 0.15:
        availability = "selling_fast"
    else:
        availability = "available"

    return {
        "id": event.id,
        "title": event.title,
        "category": event.category or "Music",
        "description": event.description or "",
        "description_html": event.description_html or "",
        "image_url": event.image_url,
        "venue": event.venue,
        "map_url": f"https://www.google.com/maps/search/?api=1&query={quote(event.venue or '')}",
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "organizer_phone": event.organizer_phone,
        "organizer_name": organisation.business_name if organisation else None,
        "artists": event.artists or [],
        "ticket_price_kes": event.ticket_price_kes,
        "total_capacity": event.total_capacity,
        "tickets_sold": event.tickets_sold,
        "tickets_remaining": remaining,
        "availability": availability,
        "max_resale_price_kes": event.max_resale_price_kes,
        "resale_royalty_percent": event.resale_royalty_percent or DEFAULT_ROYALTY_PERCENT,
        "resale_ceiling_multiplier": multiplier,
        "resale_enabled": bool(event.resale_enabled),
        "resale_window_open_days": event.resale_window_open_days or 0,
        "resale_window_close_hours": event.resale_window_close_hours if event.resale_window_close_hours is not None else 2,
        "status": status,
        "contract_address": settings.NFT_CONTRACT_ADDRESS or None,
        "gates": event.gates or [],
        "tiers": [tier_out(t, multiplier) for t in event.tiers],
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def create_event(db: Session, body, current_user: User) -> Event:
    """POST /events/ — accepts both the console's full form and the
    original flat single-tier payload (ticket_price_kes + total_capacity)."""
    if not body.tiers and body.ticket_price_kes is not None:
        body = body.model_copy(update={"tiers": [
            TierIn(name="General", price=body.ticket_price_kes, capacity=body.total_capacity or 0)
        ]})

    event = Event(
        organizer_id=body.organization_id,
        organizer_phone=body.organizer_phone or current_user.phone_number,
        created_by_user_id=current_user.id,
        tickets_sold=0,
        total_capacity=0,
        venue="",
    )
    db.add(event)
    apply_event_details(db, event, body, creating=True)
    return event
