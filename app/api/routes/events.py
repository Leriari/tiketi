from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.models import Event, EventStatus, OrganizerRole, Organizer
from app.schemas.schemas import EventCreate, EventUpdate, EventOut
from app.core.dependencies import get_current_user
from app.core.authz import check_org_role, require_event_org_role
from app.models.models import User
from app.services import organiser_service

router = APIRouter(prefix="/events", tags=["Events"])

# What the public can see. Drafts and paused events are the organiser's
# alone; sold-out events stay listed so people can see them.
_PUBLIC_STATUSES = (EventStatus.PUBLISHED, EventStatus.SOLD_OUT)


@router.post("/", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new ticketed event, under an organisation the caller owns
    (Work Order 04 B3) — "any authenticated user can create an event for
    any organiser" was the exact defect this replaces. Only an OWNER may
    create; STAFF is a scoped, view-and-scan-only role (see
    app/core/authz.py).

    Takes the Organiser Console's full form (multiple tiers, gates, resale
    settings, draft/live status) or the original flat single-tier payload
    (ticket_price_kes + total_capacity) — see organiser_service.create_event.
    """
    check_org_role(db, current_user.id, body.organization_id, OrganizerRole.OWNER)

    event = organiser_service.create_event(db, body, current_user)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}")
def update_event(
    body: EventUpdate,
    event: Event = Depends(require_event_org_role(OrganizerRole.OWNER)),
    db: Session = Depends(get_db),
):
    """
    Edit an event (Organiser Console → Event Management). Owner only.
    Price/resale changes apply to tickets sold from now on: a ticket's
    on-chain resale cap and royalty were fixed when it was minted.
    """
    organiser_service.apply_event_details(db, event, body, creating=False)
    db.commit()
    db.refresh(event)
    organisation = db.query(Organizer).filter(Organizer.id == event.organizer_id).first()
    return organiser_service.event_out(event, organisation)


@router.get("/", response_model=List[EventOut])
def list_events(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """List public (published or sold-out) events that haven't finished:
    until their end time, or their start time when no end is set. A past
    event's own page still opens (get_event below), e.g. from a ticket."""
    events = (
        db.query(Event)
        .filter(
            Event.status.in_(_PUBLIC_STATUSES),
            organiser_service.not_suspended(),
            # Naive UTC, as event dates are stored.
            func.coalesce(Event.ends_at, Event.event_date) > datetime.utcnow(),
        )
        .order_by(Event.event_date)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return events


@router.get("/{event_id}/image")
def get_event_image(event_id: str, request: Request, db: Session = Depends(get_db)):
    """
    The event's cover image. Public and unauthenticated (an <img> tag can't
    send a token), served for any event status — a cover image isn't
    sensitive, and the organiser's own draft preview needs it too.
    The URL carries ?v=<upload time> (Event.image_url), so it's cached as
    immutable: a new upload changes the URL rather than the bytes behind it.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or not event.image_mime:
        raise HTTPException(status_code=404, detail="This event has no image")
    etag = f'"{event.id}-{int(event.image_updated_at.timestamp()) if event.image_updated_at else 0}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=event.image_data,
        media_type=event.image_mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable", "ETag": etag},
    )


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: str, db: Session = Depends(get_db)):
    event = (
        db.query(Event)
        .filter(Event.id == event_id, Event.status.in_(_PUBLIC_STATUSES + (EventStatus.COMPLETED,)),
                organiser_service.not_suspended())
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event
