"""profile_image_url to TEXT

Revision ID: 009
Revises: 008
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('users', 'profile_image_url',
                    existing_type=sa.String(500),
                    type_=sa.Text(),
                    existing_nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'profile_image_url',
                    existing_type=sa.Text(),
                    type_=sa.String(500),
                    existing_nullable=True)
