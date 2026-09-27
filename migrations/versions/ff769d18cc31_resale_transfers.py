"""resale_transfers

Revision ID: ff769d18cc31
Revises: 82496cbf05c9
Create Date: 2026-09-27 19:59:09.241912

Wires the `transfers` table for real use (Work Order 02 — resale). It has
existed since the 14-table schema migration with zero rows and no routes;
this adds the columns an actual resale listing/sale lifecycle needs, and
drops payments.ticket_id's UNIQUE constraint — a ticket now legitimately
gets a second Payment row when it's resold, not just at its original
purchase.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ff769d18cc31'
down_revision: Union[str, None] = '82496cbf05c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('transfers', recreate='always') as batch_op:
        batch_op.add_column(sa.Column(
            'status',
            sa.Enum(
                'LISTED', 'PAUSED', 'PENDING_PAYMENT', 'PAID', 'COMPLETED',
                'CANCELLED', 'EXPIRED', 'SETTLEMENT_FAILED',
                name='transferstatus',
            ),
            nullable=False,
            server_default='LISTED',
        ))
        batch_op.add_column(sa.Column('event_id', sa.String(length=36), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('asking_price_kes', sa.Float(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('platform_fee_kes', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('seller_payout_kes', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('listing_tx_hash', sa.String(length=66), nullable=True))
        batch_op.add_column(sa.Column('settlement_tx_hash', sa.String(length=66), nullable=True))
        batch_op.add_column(sa.Column('cancelled_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('views', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('pause_reason', sa.String(length=255), nullable=True))
        batch_op.create_foreign_key('fk_transfers_event_id', 'events', ['event_id'], ['id'])
        # transferred_at now means "when the sale completed", not "when the
        # row was created" — so it must stay null until settlement, not the
        # NOT NULL / always-set-at-creation column the original schema had.
        batch_op.alter_column('transferred_at', existing_type=sa.DateTime(), nullable=True)

    with op.batch_alter_table('payments', recreate='always') as batch_op:
        batch_op.drop_constraint('uq_payments_ticket_id', type_='unique')


def downgrade() -> None:
    with op.batch_alter_table('payments', recreate='always') as batch_op:
        batch_op.create_unique_constraint('uq_payments_ticket_id', ['ticket_id'])

    with op.batch_alter_table('transfers', recreate='always') as batch_op:
        batch_op.alter_column('transferred_at', existing_type=sa.DateTime(), nullable=False)
        batch_op.drop_constraint('fk_transfers_event_id', type_='foreignkey')
        batch_op.drop_column('pause_reason')
        batch_op.drop_column('views')
        batch_op.drop_column('cancelled_at')
        batch_op.drop_column('settlement_tx_hash')
        batch_op.drop_column('listing_tx_hash')
        batch_op.drop_column('seller_payout_kes')
        batch_op.drop_column('platform_fee_kes')
        batch_op.drop_column('asking_price_kes')
        batch_op.drop_column('event_id')
        batch_op.drop_column('status')
