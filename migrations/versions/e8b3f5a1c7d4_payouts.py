"""payouts

Revision ID: e8b3f5a1c7d4
Revises: d4a7c2e9f1b3
Create Date: 2026-11-01 00:00:00.000000

The payouts table (seller withdrawals and organiser payouts, sent by M-Pesa
B2C/B2B) plus the paybill account number and a display label on an
organisation's payout details.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8b3f5a1c7d4'
down_revision: Union[str, None] = 'd4a7c2e9f1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUS = sa.Enum('PENDING_APPROVAL', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED', name='payoutstatus')


def upgrade() -> None:
    with op.batch_alter_table('organizers') as batch_op:
        batch_op.add_column(sa.Column('payout_account', sa.String(20), nullable=True))
        batch_op.add_column(sa.Column('payout_label', sa.String(100), nullable=True))

    op.create_table(
        'payouts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('recipient_type', sa.String(length=10), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('organizer_id', sa.String(length=36), nullable=True),
        sa.Column('wallet_transaction_id', sa.String(length=36), nullable=True),
        sa.Column('channel', sa.String(length=10), nullable=False),
        sa.Column('destination', sa.String(length=20), nullable=False),
        sa.Column('account_reference', sa.String(length=20), nullable=True),
        sa.Column('destination_label', sa.String(length=100), nullable=True),
        sa.Column('amount_kes', sa.Float(), nullable=False),
        sa.Column('charge_kes', sa.Float(), nullable=False),
        sa.Column('net_kes', sa.Float(), nullable=False),
        sa.Column('status', _STATUS, nullable=False),
        sa.Column('reviewed_by', sa.String(length=36), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=True),
        sa.Column('originator_conversation_id', sa.String(length=64), nullable=True),
        sa.Column('conversation_id', sa.String(length=64), nullable=True),
        sa.Column('mpesa_receipt', sa.String(length=20), nullable=True),
        sa.Column('recipient_name', sa.String(length=255), nullable=True),
        sa.Column('result_code', sa.String(length=20), nullable=True),
        sa.Column('result_desc', sa.Text(), nullable=True),
        sa.Column('result_payload', sa.JSON(), nullable=True),
        sa.Column('manual', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['organizer_id'], ['organizers.id']),
        sa.ForeignKeyConstraint(['wallet_transaction_id'], ['wallet_transactions.id']),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_payouts_organizer_id', 'payouts', ['organizer_id'])
    op.create_index('ix_payouts_originator_conversation_id', 'payouts', ['originator_conversation_id'])
    op.create_index('ix_payouts_conversation_id', 'payouts', ['conversation_id'])


def downgrade() -> None:
    op.drop_index('ix_payouts_conversation_id', table_name='payouts')
    op.drop_index('ix_payouts_originator_conversation_id', table_name='payouts')
    op.drop_index('ix_payouts_organizer_id', table_name='payouts')
    op.drop_table('payouts')
    _STATUS.drop(op.get_bind(), checkfirst=True)
    with op.batch_alter_table('organizers') as batch_op:
        batch_op.drop_column('payout_label')
        batch_op.drop_column('payout_account')
