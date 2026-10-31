"""card_payments

Revision ID: d4a7c2e9f1b3
Revises: c9f1e3a5b7d2
Create Date: 2026-10-31 00:00:00.000000

payments.method ("mpesa" or "card") plus the Paystack fields a card payment
is tracked by: its reference and transaction ID, and the card's brand and
last four digits for receipts. Every existing payment is M-Pesa.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a7c2e9f1b3'
down_revision: Union[str, None] = 'c9f1e3a5b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('payments') as batch_op:
        batch_op.add_column(sa.Column('method', sa.String(10), nullable=False, server_default='mpesa'))
        batch_op.add_column(sa.Column('provider_reference', sa.String(100), nullable=True))
        batch_op.add_column(sa.Column('provider_transaction_id', sa.String(50), nullable=True))
        batch_op.add_column(sa.Column('card_brand', sa.String(20), nullable=True))
        batch_op.add_column(sa.Column('card_last4', sa.String(4), nullable=True))
    op.create_index('ix_payments_provider_reference', 'payments', ['provider_reference'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_payments_provider_reference', table_name='payments')
    with op.batch_alter_table('payments') as batch_op:
        batch_op.drop_column('card_last4')
        batch_op.drop_column('card_brand')
        batch_op.drop_column('provider_transaction_id')
        batch_op.drop_column('provider_reference')
        batch_op.drop_column('method')
