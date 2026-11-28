"""ticket_gates

Revision ID: c5d1e8a2f4b7
Revises: b2e7c4f9a6d1
Create Date: 2026-11-28 00:00:00.000000

Each ticket gets a stored gate (tickets.gate_name), chosen when it's
created, so attendees can be told which gate to use. Tiers can be tied to
a gate (event_tiers.gate_name). Events with no gate list get "Gate A",
the default every new event starts with. Existing tickets are given a gate here:
spread evenly over each event's gates, oldest ticket first, the same way
new tickets are (app/services/gates.py; no tier is tied to a gate yet).
"""
import uuid
from collections import Counter
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c5d1e8a2f4b7'
down_revision: Union[str, None] = 'b2e7c4f9a6d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LIVE = ("PENDING_PAYMENT", "ACTIVE", "RESALE", "USED")


def upgrade() -> None:
    op.add_column("tickets", sa.Column("gate_name", sa.String(length=100), nullable=True))
    op.add_column("event_tiers", sa.Column("gate_name", sa.String(length=100), nullable=True))

    conn = op.get_bind()
    events = sa.table("events", sa.column("id", sa.String), sa.column("gates", sa.JSON))
    tickets = sa.table(
        "tickets", sa.column("id", sa.String), sa.column("event_id", sa.String),
        sa.column("status", sa.String), sa.column("created_at", sa.DateTime), sa.column("gate_name", sa.String),
    )
    for event_id, gates in conn.execute(sa.select(events.c.id, events.c.gates)).all():
        names = [g.get("name") for g in (gates or []) if isinstance(g, dict) and g.get("name")]
        if not names:
            # Older events had no gate list: give them the one every new
            # event starts with (organiser_service.apply_event_details).
            names = ["Gate A"]
            conn.execute(sa.update(events).where(events.c.id == event_id).values(
                gates=[{"id": str(uuid.uuid4()), "name": "Gate A"}]))
        rows = conn.execute(
            sa.select(tickets.c.id)
            .where(tickets.c.event_id == event_id, tickets.c.status.in_(_LIVE))
            .order_by(tickets.c.created_at)
        ).all()
        load = Counter()
        for (ticket_id,) in rows:
            gate = min(names, key=lambda n: (load[n], names.index(n)))
            load[gate] += 1
            conn.execute(sa.update(tickets).where(tickets.c.id == ticket_id).values(gate_name=gate))


def downgrade() -> None:
    with op.batch_alter_table("event_tiers") as batch:  # batch: SQLite can't drop columns in place
        batch.drop_column("gate_name")
    with op.batch_alter_table("tickets") as batch:
        batch.drop_column("gate_name")
