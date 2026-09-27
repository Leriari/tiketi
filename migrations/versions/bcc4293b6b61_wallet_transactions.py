"""wallet_transactions

Revision ID: bcc4293b6b61
Revises: ff769d18cc31
Create Date: 2026-09-27 20:45:00.000000

New table, not a repurposing of an existing one — resale payouts (Work
Order 02) are money movement this project didn't track anywhere before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bcc4293b6b61'
down_revision: Union[str, None] = 'ff769d18cc31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'wallet_transactions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('transfer_id', sa.String(length=36), nullable=True),
        sa.Column('type', sa.Enum('SALE', 'WITHDRAWAL', name='wallettransactiontype'), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=False),
        sa.Column('amount_kes', sa.Float(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('SUCCESS', 'PENDING', 'FAILED', name='wallettransactionstatus'),
            nullable=False,
            server_default='SUCCESS',
        ),
        sa.Column('available_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['transfer_id'], ['transfers.id']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('wallet_transactions')
