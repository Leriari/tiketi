"""attendance_denial_reason

Revision ID: 367d87891e97
Revises: 1dffd931ff43
Create Date: 2026-10-15 00:00:00.000000

Work Order 05 B2 — Attendance had no column for *why* a scan was denied,
only admitted/denied. The offline validator (validate.js) already returns
a structured reason code for every verdict (REASON.UNKNOWN_TICKET,
REASON.BAD_OTP, REASON.ALREADY_ADMITTED, REASON.WRONG_GATE, etc. — see
docs/offline-validation.md) — this just gives the upload endpoint
(/gate/scan-upload, B5) somewhere real to put it, turning a single
accuracy figure into a breakdown by failure type.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '367d87891e97'
down_revision: Union[str, None] = '1dffd931ff43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('attendances') as batch_op:
        batch_op.add_column(sa.Column('denial_reason', sa.String(length=30), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('attendances') as batch_op:
        batch_op.drop_column('denial_reason')
