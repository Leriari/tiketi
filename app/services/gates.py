"""
Which gate each ticket enters by.

A ticket's gate is chosen once, when the ticket is created, and stored on
it (Ticket.gate_name), so the attendee can be told well before the event
and the answer doesn't change when scanner phones are added. The rule:

1. If the organiser tied the ticket's tier to a gate (EventTier.gate_name,
   e.g. VIP -> "VIP Entrance"), that gate.
2. Otherwise the event's least-used open gate: the one with the fewest
   tickets so far, in the organiser's gate order on a tie. A gate that some
   tier is tied to is kept for that tier, unless every gate is.

A gate phone downloads only its own gate's ticket secrets (gate.py), so a
ticket can't be admitted at two gates while they're offline.

When the organiser changes the gates (rename, remove) or the tier rules,
reconcile_event() moves the affected tickets, and attendees see the new
gate on their ticket.
"""
from collections import Counter

from sqlalchemy.orm import Session

from app.models.models import Event, EventTier, Ticket, TicketStatus

# Tickets that still need a gate (or still count towards a gate's load).
_LIVE = (TicketStatus.PENDING_PAYMENT, TicketStatus.ACTIVE, TicketStatus.RESALE, TicketStatus.USED)


def gate_names(event: Event) -> list[str]:
    """The event's gates, in the organiser's order."""
    return [g["name"] for g in (event.gates or []) if g.get("name")]


def _reserved(event: Event, names: list[str]) -> set[str]:
    return {t.gate_name for t in event.tiers if t.gate_name in names}


def _load(db: Session, event: Event) -> Counter:
    rows = (
        db.query(Ticket.gate_name)
        .filter(Ticket.event_id == event.id, Ticket.status.in_(_LIVE), Ticket.gate_name.isnot(None))
        .all()
    )
    return Counter(name for (name,) in rows)


def ticket_counts(db: Session, event: Event) -> dict[str, int]:
    """Tickets per gate, every gate listed (0 when none)."""
    load = _load(db, event)
    return {name: load[name] for name in gate_names(event)}


def pick_gate(db: Session, event: Event, tier: EventTier | None, load: Counter | None = None) -> str | None:
    names = gate_names(event)
    if not names:
        return None
    if tier is not None and tier.gate_name in names:
        return tier.gate_name
    open_gates = [n for n in names if n not in _reserved(event, names)] or names
    load = load if load is not None else _load(db, event)
    return min(open_gates, key=lambda n: (load[n], names.index(n)))


def assign(db: Session, ticket: Ticket, event: Event, tier: EventTier | None) -> str | None:
    """Give a new ticket its gate. Call after the ticket is added to the session."""
    ticket.gate_name = pick_gate(db, event, tier)
    db.flush()
    return ticket.gate_name


def reconcile_event(db: Session, event: Event, renamed: dict[str, str] | None = None) -> int:
    """Bring tickets in line with the event's current gates and tier rules.
    `renamed` maps old gate names to new ones (a renamed gate keeps its
    tickets). Moves tickets whose gate no longer exists, or whose tier is
    now tied to a different gate, and gives a gate to any ticket without
    one. Returns how many tickets got a new gate."""
    names = gate_names(event)
    tickets = (
        db.query(Ticket)
        .filter(Ticket.event_id == event.id, Ticket.status.in_(_LIVE))
        .order_by(Ticket.created_at)
        .all()
    )
    for old, new in (renamed or {}).items():
        for t in tickets:
            if t.gate_name == old:
                t.gate_name = new
    if not names:
        return 0

    tiers = {t.id: t for t in event.tiers}
    load = Counter(t.gate_name for t in tickets if t.gate_name in names)
    moved = 0
    for t in tickets:
        tier = tiers.get(t.tier_id)
        tied = tier.gate_name if tier is not None and tier.gate_name in names else None
        if t.gate_name in names and (tied is None or t.gate_name == tied):
            continue
        if t.status == TicketStatus.USED and t.gate_name:
            continue  # already through a gate: leave its record alone
        if t.gate_name in names:
            load[t.gate_name] -= 1
        had_gate = t.gate_name is not None
        t.gate_name = pick_gate(db, event, tier, load)
        load[t.gate_name] += 1
        moved += had_gate
    db.flush()
    return moved
