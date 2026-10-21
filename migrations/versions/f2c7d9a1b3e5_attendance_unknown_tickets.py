"""attendance_unknown_tickets

Revision ID: f2c7d9a1b3e5
Revises: e8b3a6d4c1f7
Create Date: 2026-10-20 00:00:00.000000

A gate scan of a QR that names a non-existent ticket (forged or garbled)
couldn't be stored: attendances.ticket_id is a foreign key, which Postgres
enforces (SQLite didn't), so one such scan failed a whole offline upload.
ticket_id becomes nullable and the raw scanned id goes in scanned_ref.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2c7d9a1b3e5'
down_revision: Union[str, None] = 'e8b3a6d4c1f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('attendances') as batch_op:
        batch_op.add_column(sa.Column('scanned_ref', sa.String(length=64), nullable=True))
        batch_op.alter_column('ticket_id', existing_type=sa.String(length=36), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM attendances WHERE ticket_id IS NULL")
    with op.batch_alter_table('attendances') as batch_op:
        batch_op.alter_column('ticket_id', existing_type=sa.String(length=36), nullable=False)
        batch_op.drop_column('scanned_ref')
