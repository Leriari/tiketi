"""wallet_purchase_type

Revision ID: b2e7c4f9a6d1
Revises: a4d8e2f6b1c9
Create Date: 2026-11-24 00:00:00.000000

wallet_transactions.type gains PURCHASE: a buyer paying for a resale ticket
from their ChainTix wallet balance. Postgres stores the enum as its own
type, which needs the new value added; SQLite stores it as plain text, so
there is nothing to change there.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2e7c4f9a6d1'
down_revision: Union[str, None] = 'a4d8e2f6b1c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE wallettransactiontype ADD VALUE IF NOT EXISTS 'PURCHASE'")


def downgrade() -> None:
    # Postgres can't drop a value from an enum type. A PURCHASE row would
    # have to be removed by hand first; the unused value is harmless.
    pass
