"""wallet feature

Revision ID: 008_wallet
Revises: 007_chat_messages
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('wallet_balance', sa.Numeric(12, 2), nullable=False, server_default='0'))

    op.create_table(
        'wallet_transactions',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(10), nullable=False),  # CREDIT | DEBIT
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('balance_after', sa.Numeric(12, 2), nullable=False),
        sa.Column('trip_id', sa.BigInteger, sa.ForeignKey('trips.id', ondelete='SET NULL'), nullable=True),
        sa.Column('description', sa.String(255), nullable=False, server_default=''),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_wallet_tx_user_id', 'wallet_transactions', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_wallet_tx_user_id', 'wallet_transactions')
    op.drop_table('wallet_transactions')
    op.drop_column('users', 'wallet_balance')
