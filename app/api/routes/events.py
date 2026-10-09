from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.models import Event, EventTier, EventStatus, TierStatus
from app.schemas.schemas import EventCreate, EventOut
from app.core.dependencies import get_current_user
from app.models.models import User

router = APIRouter(prefix="/events", tags=["Events"])


@router.post("/", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new ticketed event.

    Pricing/capacity/resale rules are stored on a single "General" EventTier —
    Event itself only holds venue-wide totals. The request/response API stays
    flat for now; multi-tier events are a Phase 2 API change.
    """
    event = Event(
        title=body.title,
        description=body.description,
        venue=body.venue,
        event_date=body.event_date,
        organizer_phone=body.organizer_phone,
        total_capacity=body.total_capacity,
        status=EventStatus.PUBLISHED,
        created_by_user_id=current_user.id,
    )
    db.add(event)
    db.flush()  # get event.id without committing

    tier = EventTier(
        event_id=event.id,
        tier_name="General",
        price_kes=body.ticket_price_kes,
        capacity=body.total_capacity,
        resale_floor_price_kes=body.ticket_price_kes,
        resale_ceiling_price_kes=round(body.ticket_price_kes * body.max_resale_multiplier, 2),
        organizer_royalty_percent=body.resale_royalty_percent,
        status=TierStatus.ACTIVE,
    )
    db.add(tier)

    db.commit()
    db.refresh(event)
    return event


@router.get("/", response_model=List[EventOut])
def list_events(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """List all published events."""
    events = (
        db.query(Event)
        .filter(Event.status == EventStatus.PUBLISHED)
        .order_by(Event.event_date)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return events


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event
