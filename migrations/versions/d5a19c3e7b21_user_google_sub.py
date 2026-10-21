"""user_google_sub

Revision ID: d5a19c3e7b21
Revises: c41e8b7d2f90
Create Date: 2026-10-19 00:00:00.000000

"Continue with Google": users.google_sub records the Google account linked
to a (phone-verified) user. Unique, so one Google account maps to exactly
one ChainTix account.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5a19c3e7b21'
down_revision: Union[str, None] = 'c41e8b7d2f90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('google_sub', sa.String(length=255), nullable=True))
        batch_op.create_index('ix_users_google_sub', ['google_sub'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_index('ix_users_google_sub')
        batch_op.drop_column('google_sub')
