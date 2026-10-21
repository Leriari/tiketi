"""event_cover_image_blob

Revision ID: c41e8b7d2f90
Revises: a7c3e91f0b42
Create Date: 2026-10-19 00:00:00.000000

Event cover images move from a raw base64 data: URL (events.image_data_url,
returned inside every event payload — megabytes per list call) to processed
bytes served from their own endpoint (GET /events/{id}/image):

- events.image_data  — the image bytes (WebP after processing)
- events.image_mime  — its content type
- events.image_updated_at — versions the image URL for caching

Existing data: URLs are decoded and, when Pillow can read them, resized and
re-encoded the same way new uploads are; anything unreadable is dropped
rather than served broken.
"""
import base64
import io
import re
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c41e8b7d2f90'
down_revision: Union[str, None] = 'a7c3e91f0b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.DOTALL)


def _convert(data_url: str):
    """Self-contained copy of the upload processing (a migration must not
    depend on app code that may change later)."""
    match = _DATA_URL.match(data_url or "")
    if not match:
        return None
    try:
        raw = base64.b64decode(match.group("data"))
        from PIL import Image, ImageOps
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        image.thumbnail((1600, 1600))
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() or image.mode == "P" else "RGB")
        out = io.BytesIO()
        image.save(out, format="WEBP", quality=82, method=4)
        return out.getvalue(), "image/webp"
    except Exception:
        return None


def upgrade() -> None:
    with op.batch_alter_table('events') as batch_op:
        batch_op.add_column(sa.Column('image_data', sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column('image_mime', sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column('image_updated_at', sa.DateTime(), nullable=True))

    conn = op.get_bind()
    events = sa.table(
        'events',
        sa.column('id', sa.String), sa.column('image_data_url', sa.Text),
        sa.column('image_data', sa.LargeBinary), sa.column('image_mime', sa.String),
        sa.column('image_updated_at', sa.DateTime),
    )
    rows = conn.execute(sa.select(events.c.id, events.c.image_data_url).where(events.c.image_data_url.isnot(None))).fetchall()
    now = datetime.utcnow()
    for event_id, data_url in rows:
        converted = _convert(data_url)
        if converted:
            conn.execute(
                events.update().where(events.c.id == event_id)
                .values(image_data=converted[0], image_mime=converted[1], image_updated_at=now)
            )

    with op.batch_alter_table('events') as batch_op:
        batch_op.drop_column('image_data_url')


def downgrade() -> None:
    with op.batch_alter_table('events') as batch_op:
        batch_op.add_column(sa.Column('image_data_url', sa.Text(), nullable=True))

    conn = op.get_bind()
    events = sa.table(
        'events',
        sa.column('id', sa.String), sa.column('image_data_url', sa.Text),
        sa.column('image_data', sa.LargeBinary), sa.column('image_mime', sa.String),
    )
    rows = conn.execute(sa.select(events.c.id, events.c.image_data, events.c.image_mime).where(events.c.image_data.isnot(None))).fetchall()
    for event_id, data, mime in rows:
        conn.execute(
            events.update().where(events.c.id == event_id)
            .values(image_data_url=f"data:{mime};base64,{base64.b64encode(data).decode()}")
        )

    with op.batch_alter_table('events') as batch_op:
        batch_op.drop_column('image_updated_at')
        batch_op.drop_column('image_mime')
        batch_op.drop_column('image_data')
