"""ticket_onchain_limits

Revision ID: a4d8e2f6b1c9
Revises: f1c5a9d3e7b2
Create Date: 2026-11-09 00:00:00.000000

tickets.onchain_face_kes / onchain_floor_kes / onchain_cap_kes: the face
value and resale limits fixed on the contract when the ticket was minted.
An organiser can change a ticket type's price or limits later; tickets
already minted keep theirs. Existing tickets stay null and are filled from
the chain the first time they're needed (app/api/routes/resale.py).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4d8e2f6b1c9'
down_revision: Union[str, None] = 'f1c5a9d3e7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.add_column(sa.Column('onchain_face_kes', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('onchain_floor_kes', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('onchain_cap_kes', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.drop_column('onchain_cap_kes')
        batch_op.drop_column('onchain_floor_kes')
        batch_op.drop_column('onchain_face_kes')
