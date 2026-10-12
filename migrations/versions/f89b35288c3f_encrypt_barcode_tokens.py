"""encrypt_barcode_tokens

Revision ID: f89b35288c3f
Revises: 147ebeab12f3
Create Date: 2026-10-12 00:00:00.000000

Work Order 04 A4 — Barcode.token (the TOTP secret seed) has been stored in
plaintext since the first migration; anyone who could read that column
could generate a valid credential for every ticket in the system. This
widens the column (a Fernet token is well over the old String(64) limit)
and encrypts every existing row in place with app.core.crypto.encrypt_secret,
which reads CREDENTIAL_ENCRYPTION_KEY from the running environment —
that variable must already be set before this migration runs.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f89b35288c3f'
down_revision: Union[str, None] = '147ebeab12f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

barcodes_table = sa.table(
    "barcodes",
    sa.column("id", sa.String(36)),
    sa.column("token", sa.Text()),
)


def upgrade() -> None:
    with op.batch_alter_table('barcodes') as batch_op:
        batch_op.alter_column('token', type_=sa.Text(), existing_type=sa.String(length=64))

    from app.core.crypto import encrypt_secret

    conn = op.get_bind()
    rows = conn.execute(sa.select(barcodes_table.c.id, barcodes_table.c.token)).fetchall()
    for row_id, plaintext_token in rows:
        # Already-encrypted tokens are never plain base32 (Fernet output
        # always starts with "gAAAAA..."-style base64, far longer than 32
        # chars) — guards against double-encrypting if this migration is
        # ever re-run against a DB that already went through it.
        if len(plaintext_token) <= 40:
            conn.execute(
                barcodes_table.update()
                .where(barcodes_table.c.id == row_id)
                .values(token=encrypt_secret(plaintext_token))
            )


def downgrade() -> None:
    from app.core.crypto import decrypt_secret

    conn = op.get_bind()
    rows = conn.execute(sa.select(barcodes_table.c.id, barcodes_table.c.token)).fetchall()
    for row_id, ciphertext_token in rows:
        if len(ciphertext_token) > 40:
            conn.execute(
                barcodes_table.update()
                .where(barcodes_table.c.id == row_id)
                .values(token=decrypt_secret(ciphertext_token))
            )

    with op.batch_alter_table('barcodes') as batch_op:
        batch_op.alter_column('token', type_=sa.String(length=64), existing_type=sa.Text())
