"""roles_orgs_and_scanner_devices

Revision ID: 1dffd931ff43
Revises: f89b35288c3f
Create Date: 2026-10-12 00:00:00.000000

Work Order 04 B1/B4 schema groundwork:
  - OrganizerMember.role narrows to OWNER/STAFF (GATE_OPERATOR is removed —
    scanning is now a device-token identity, B4, not a per-org user role).
    No existing rows reference GATE_OPERATOR (organizer_members has 0 rows
    in every environment this was checked against), so this is a safe
    constraint narrowing, not a data migration.
  - users.is_platform_admin: the one genuinely global role (B1) — every
    other role is a relationship between a user and an organisation.
  - gate_scanners gains the columns B4's enrolment flow needs:
    device_id becomes nullable (a scanner is registered — and gets an
    enrolment code — before any physical device has connected and chosen
    an id for itself), enrollment_code + its expiry (single-use, time
    limited), and device_token_hash (the long-lived device credential is
    stored hashed, never in plaintext — same reasoning as a password or
    API key, not the OTP case where the plaintext has to be read back).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1dffd931ff43'
down_revision: Union[str, None] = 'f89b35288c3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('organizer_members') as batch_op:
        batch_op.alter_column(
            'role',
            type_=sa.Enum('OWNER', 'STAFF', name='organizerrole'),
            existing_type=sa.Enum('OWNER', 'STAFF', 'GATE_OPERATOR', name='organizerrole'),
        )

    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('is_platform_admin', sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table('gate_scanners') as batch_op:
        batch_op.alter_column('device_id', existing_type=sa.String(length=100), nullable=True)
        batch_op.add_column(sa.Column('enrollment_code', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('enrollment_code_expires_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('device_token_hash', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_gate_scanners_device_token_hash', ['device_token_hash'])
        batch_op.create_index('ix_gate_scanners_enrollment_code', ['enrollment_code'])


def downgrade() -> None:
    with op.batch_alter_table('gate_scanners') as batch_op:
        batch_op.drop_index('ix_gate_scanners_enrollment_code')
        batch_op.drop_index('ix_gate_scanners_device_token_hash')
        batch_op.drop_column('device_token_hash')
        batch_op.drop_column('enrollment_code_expires_at')
        batch_op.drop_column('enrollment_code')
        batch_op.alter_column('device_id', existing_type=sa.String(length=100), nullable=False)

    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('is_platform_admin')

    with op.batch_alter_table('organizer_members') as batch_op:
        batch_op.alter_column(
            'role',
            type_=sa.Enum('OWNER', 'STAFF', 'GATE_OPERATOR', name='organizerrole'),
            existing_type=sa.Enum('OWNER', 'STAFF', name='organizerrole'),
        )
