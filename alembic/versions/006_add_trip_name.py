"""add trip_name column

Revision ID: 006
Revises: 005_add_driver_location
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005_add_driver_location"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("trip_name", sa.String(200), nullable=True))
    op.execute("""
        UPDATE trips
        SET trip_name = CONCAT(
            SPLIT_PART(pickup_address, ',', 1),
            ' → ',
            SPLIT_PART(destination_address, ',', 1),
            ' · ',
            TO_CHAR(created_at AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI')
        )
    """)


def downgrade() -> None:
    op.drop_column("trips", "trip_name")
