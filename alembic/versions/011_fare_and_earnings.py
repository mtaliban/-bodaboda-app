"""Add fare_tzs to trips and admin_earnings table

Revision ID: 011
Revises: 010
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("fare_tzs", sa.Integer(), nullable=True))

    op.create_table(
        "admin_earnings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("trip_id", sa.BigInteger(), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_earnings_trip_id", "admin_earnings", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_earnings_trip_id", table_name="admin_earnings")
    op.drop_table("admin_earnings")
    op.drop_column("trips", "fare_tzs")
