"""email_receipts

Revision ID: c9f1e3a5b7d2
Revises: b6e2f4a8c1d9
Create Date: 2026-10-26 00:00:00.000000

users.email_verified (true when the address came from Google),
tickets.used_tx_hash (the on-chain markUsed record of an admission) and
notifications.reference (the payment or transfer an email was about, so a
retried task never sends the same receipt twice). Existing users who linked
Google got their email from it, so they start verified.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9f1e3a5b7d2'
down_revision: Union[str, None] = 'b6e2f4a8c1d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE users SET email_verified = true WHERE google_sub IS NOT NULL AND email IS NOT NULL")

    with op.batch_alter_table('tickets') as batch_op:
        batch_op.add_column(sa.Column('used_tx_hash', sa.String(66), nullable=True))

    with op.batch_alter_table('notifications') as batch_op:
        batch_op.add_column(sa.Column('reference', sa.String(64), nullable=True))
    op.create_index('ix_notifications_reference', 'notifications', ['reference'])


def downgrade() -> None:
    op.drop_index('ix_notifications_reference', table_name='notifications')
    with op.batch_alter_table('notifications') as batch_op:
        batch_op.drop_column('reference')
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.drop_column('used_tx_hash')
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('email_verified')
