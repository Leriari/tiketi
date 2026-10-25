"""platform_admin

Revision ID: b6e2f4a8c1d9
Revises: a1d4e6f8b2c3
Create Date: 2026-10-25 00:00:00.000000

Backs the Platform Admin console: organiser review/suspension, event
approvals, admin roles and invites, the fee schedule, feature flags and
broadcasts. No rows are seeded — every setting falls back to its built-in
default (app/services/platform_settings.py) until an admin changes it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6e2f4a8c1d9'
down_revision: Union[str, None] = 'a1d4e6f8b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('platform_admin_role', sa.String(20), nullable=True))
        batch_op.add_column(sa.Column('platform_admin_since', sa.DateTime(), nullable=True))

    with op.batch_alter_table('organizers') as batch_op:
        batch_op.add_column(sa.Column('review_reason', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('reviewed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('suspended_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('suspended_reason', sa.Text(), nullable=True))

    with op.batch_alter_table('events') as batch_op:
        batch_op.add_column(sa.Column('review_state', sa.String(20), nullable=True))
        batch_op.add_column(sa.Column('review_note', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('submitted_for_review_at', sa.DateTime(), nullable=True))

    op.create_table(
        'fee_schedule',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('platform_fee_percent', sa.Float(), nullable=False),
        sa.Column('scanning_fee_kes', sa.Float(), nullable=False),
        sa.Column('min_payout_kes', sa.Float(), nullable=False),
        sa.Column('seller_escrow_days', sa.Integer(), nullable=False),
        sa.Column('organiser_escrow_days', sa.Integer(), nullable=False),
        sa.Column('effective_from', sa.DateTime(), nullable=False),
        sa.Column('changed_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
    )
    op.create_index('ix_fee_schedule_effective_from', 'fee_schedule', ['effective_from'])

    op.create_table(
        'feature_flags',
        sa.Column('key', sa.String(50), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('rollout_percent', sa.Integer(), nullable=False),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'broadcasts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('channels', sa.JSON(), nullable=False),
        sa.Column('audience', sa.String(20), nullable=False),
        sa.Column('audience_size', sa.Integer(), nullable=False),
        sa.Column('scheduled_for', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'admin_invites',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('phone_number', sa.String(15), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('invited_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('admin_invites')
    op.drop_table('broadcasts')
    op.drop_table('feature_flags')
    op.drop_index('ix_fee_schedule_effective_from', table_name='fee_schedule')
    op.drop_table('fee_schedule')

    with op.batch_alter_table('events') as batch_op:
        batch_op.drop_column('submitted_for_review_at')
        batch_op.drop_column('review_note')
        batch_op.drop_column('review_state')

    with op.batch_alter_table('organizers') as batch_op:
        batch_op.drop_column('suspended_reason')
        batch_op.drop_column('suspended_at')
        batch_op.drop_column('reviewed_at')
        batch_op.drop_column('review_reason')

    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('platform_admin_since')
        batch_op.drop_column('platform_admin_role')
