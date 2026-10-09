"""event_creator_and_gate_registration

Revision ID: 147ebeab12f3
Revises: 5b8936e65664
Create Date: 2026-10-09 00:00:00.000000

Adds events.created_by_user_id — Work Order 03's gate-sync authorization
needs a real signal for "who owns this event," and none existed (not even
informally; create_event never stored the creating user anywhere).
Nullable: events created before this migration have no creator on record.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '147ebeab12f3'
down_revision: Union[str, None] = '5b8936e65664'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('events') as batch_op:
        batch_op.add_column(sa.Column('created_by_user_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key('fk_events_created_by_user_id', 'users', ['created_by_user_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('events') as batch_op:
        batch_op.drop_constraint('fk_events_created_by_user_id', type_='foreignkey')
        batch_op.drop_column('created_by_user_id')
