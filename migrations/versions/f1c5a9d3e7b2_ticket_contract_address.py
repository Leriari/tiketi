"""ticket_contract_address

Revision ID: f1c5a9d3e7b2
Revises: e8b3f5a1c7d4
Create Date: 2026-11-01 00:00:00.000000

tickets.nft_contract_address: which TiketiNFT contract a ticket was minted
on, now that a second version (with an on-chain resale floor) exists.
Existing tickets stay null, meaning NFT_LEGACY_CONTRACT_ADDRESS.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1c5a9d3e7b2'
down_revision: Union[str, None] = 'e8b3f5a1c7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.add_column(sa.Column('nft_contract_address', sa.String(42), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tickets') as batch_op:
        batch_op.drop_column('nft_contract_address')
