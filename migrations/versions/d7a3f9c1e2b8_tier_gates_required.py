"""tier_gates_required

Revision ID: d7a3f9c1e2b8
Revises: c5d1e8a2f4b7
Create Date: 2026-11-28 00:00:00.000000

Every tier now has its own entry gate. Events with a single gate: each of
their tiers gets that gate, and their tickets follow. Events with more
than one gate are left for the organiser to choose (the event form asks
before it saves).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd7a3f9c1e2b8'
down_revision: Union[str, None] = 'c5d1e8a2f4b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    events = sa.table("events", sa.column("id", sa.String), sa.column("gates", sa.JSON))
    tiers = sa.table("event_tiers", sa.column("event_id", sa.String), sa.column("gate_name", sa.String))
    tickets = sa.table("tickets", sa.column("event_id", sa.String), sa.column("gate_name", sa.String))
    for event_id, gates in conn.execute(sa.select(events.c.id, events.c.gates)).all():
        names = [g.get("name") for g in (gates or []) if isinstance(g, dict) and g.get("name")]
        if len(names) != 1:
            continue
        conn.execute(sa.update(tiers).where(tiers.c.event_id == event_id, tiers.c.gate_name.is_(None)).values(gate_name=names[0]))
        conn.execute(sa.update(tickets).where(tickets.c.event_id == event_id).values(gate_name=names[0]))


def downgrade() -> None:
    pass  # tier gates are kept; nothing to undo
