"""user_phone_verified

Revision ID: a1d4e6f8b2c3
Revises: f2c7d9a1b3e5
Create Date: 2026-10-20 00:00:00.000000

users.phone_verified: false only for a Google user whose number was recorded
without a code (deployments with no SMS, GOOGLE_PHONE_CONFIRMATION=unverified).
Every existing account verified its phone with a code, so they default true.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1d4e6f8b2c3'
down_revision: Union[str, None] = 'f2c7d9a1b3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('phone_verified', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('phone_verified')
