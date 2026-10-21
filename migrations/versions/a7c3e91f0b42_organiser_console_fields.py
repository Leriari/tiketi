"""organiser_console_fields

Revision ID: a7c3e91f0b42
Revises: 367d87891e97
Create Date: 2026-10-19 00:00:00.000000

Backs the Organiser Console with real columns. Its Event Management form,
complimentary tickets, organisation profile/payout settings and scanner
labels were all mock-only until now, with nowhere to persist them:

- events: category, rich description, image, end time, artists, gate list,
  resale on/off and resale window
- event_tiers: description, per-order max, visibility, sales window, order
- tickets: complimentary flag/note/recipient name
- organizers: contact email/phone, payout method/destination
- gate_scanners: a human label for the device
- audit_logs: free-text details (a manual override's reason, an export's
  type/format) — the table only had an action type and target before
- EventStatus gains PAUSED and SOLD_OUT (stored by name; on SQLite the
  column is a plain VARCHAR, on Postgres the enum type needs the values)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e91f0b42'
down_revision: Union[str, None] = '367d87891e97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE eventstatus ADD VALUE IF NOT EXISTS 'PAUSED'")
        op.execute("ALTER TYPE eventstatus ADD VALUE IF NOT EXISTS 'SOLD_OUT'")

    with op.batch_alter_table('events') as batch_op:
        batch_op.add_column(sa.Column('category', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('description_html', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('image_data_url', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ends_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('artists', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('gates', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('resale_enabled', sa.Boolean(), nullable=False, server_default='1'))
        batch_op.add_column(sa.Column('resale_window_open_days', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('resale_window_close_hours', sa.Integer(), nullable=False, server_default='2'))

    with op.batch_alter_table('event_tiers') as batch_op:
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('per_order_max', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('visibility', sa.String(length=20), nullable=False, server_default='public'))
        batch_op.add_column(sa.Column('sales_start', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('sales_end', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))

    with op.batch_alter_table('tickets') as batch_op:
        batch_op.add_column(sa.Column('is_complimentary', sa.Boolean(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('complimentary_note', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('recipient_name', sa.String(length=100), nullable=True))

    with op.batch_alter_table('organizers') as batch_op:
        batch_op.add_column(sa.Column('contact_email', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('contact_phone', sa.String(length=15), nullable=True))
        batch_op.add_column(sa.Column('payout_method', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('payout_destination', sa.String(length=50), nullable=True))

    with op.batch_alter_table('gate_scanners') as batch_op:
        batch_op.add_column(sa.Column('label', sa.String(length=100), nullable=True))

    with op.batch_alter_table('audit_logs') as batch_op:
        batch_op.add_column(sa.Column('details', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('audit_logs') as batch_op:
        batch_op.drop_column('details')

    with op.batch_alter_table('gate_scanners') as batch_op:
        batch_op.drop_column('label')

    with op.batch_alter_table('organizers') as batch_op:
        for col in ('payout_destination', 'payout_method', 'contact_phone', 'contact_email'):
            batch_op.drop_column(col)

    with op.batch_alter_table('tickets') as batch_op:
        for col in ('recipient_name', 'complimentary_note', 'is_complimentary'):
            batch_op.drop_column(col)

    with op.batch_alter_table('event_tiers') as batch_op:
        for col in ('sort_order', 'sales_end', 'sales_start', 'visibility', 'per_order_max', 'description'):
            batch_op.drop_column(col)

    with op.batch_alter_table('events') as batch_op:
        for col in ('resale_window_close_hours', 'resale_window_open_days', 'resale_enabled', 'gates',
                    'artists', 'ends_at', 'image_data_url', 'description_html', 'category'):
            batch_op.drop_column(col)
    # Postgres can't drop enum values; PAUSED/SOLD_OUT stay in the type.
