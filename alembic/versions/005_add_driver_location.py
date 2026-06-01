"""add current_lat/lng to drivers table

Revision ID: 005
Revises: 004
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('drivers', sa.Column('current_lat', sa.Float(), nullable=True))
    op.add_column('drivers', sa.Column('current_lng', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('drivers', 'current_lng')
    op.drop_column('drivers', 'current_lat')
