"""multi_ticket_purchase

Revision ID: 5b8936e65664
Revises: bcc4293b6b61
Create Date: 2026-09-28 12:05:00.000000

Lets one /purchase call buy more than one ticket for the same event in a
single payment, and removes the one-active-ticket-per-event restriction so
a user can buy repeatedly.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b8936e65664'
down_revision: Union[str, None] = 'bcc4293b6b61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('payments') as batch_op:
        batch_op.add_column(sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'))

    with op.batch_alter_table('tickets') as batch_op:
        batch_op.add_column(sa.Column('group_payment_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key('fk_tickets_group_payment_id', 'payments', ['group_payment_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.drop_constraint('fk_tickets_group_payment_id', type_='foreignkey')
        batch_op.drop_column('group_payment_id')

    with op.batch_alter_table('payments') as batch_op:
        batch_op.drop_column('quantity')
