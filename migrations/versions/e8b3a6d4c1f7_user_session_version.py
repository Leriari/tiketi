"""user_session_version

Revision ID: e8b3a6d4c1f7
Revises: d5a19c3e7b21
Create Date: 2026-10-19 00:00:00.000000

"Sign out everywhere": users.session_version is embedded in every access
token (the `sv` claim) and checked on each request; bumping it ends every
session issued before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8b3a6d4c1f7'
down_revision: Union[str, None] = 'd5a19c3e7b21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('session_version', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('session_version')
