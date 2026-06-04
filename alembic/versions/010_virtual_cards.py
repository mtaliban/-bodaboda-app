"""virtual_cards table

Revision ID: 010
Revises: 009
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'virtual_cards',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger,
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, unique=True),
        sa.Column('card_number', sa.String(19), nullable=False),
        sa.Column('expiry_month', sa.Integer, nullable=False),
        sa.Column('expiry_year', sa.Integer, nullable=False),
        sa.Column('cvv', sa.String(3), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_virtual_cards_user_id', 'virtual_cards', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_virtual_cards_user_id', 'virtual_cards')
    op.drop_table('virtual_cards')
