"""add lat/lng coordinates to trips table

Revision ID: 004
Revises: 003
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('pickup_lat', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('pickup_lng', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('destination_lat', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('destination_lng', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('trips', 'destination_lng')
    op.drop_column('trips', 'destination_lat')
    op.drop_column('trips', 'pickup_lng')
    op.drop_column('trips', 'pickup_lat')
