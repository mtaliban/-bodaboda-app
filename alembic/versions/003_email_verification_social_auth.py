"""add email verification and social auth fields

Revision ID: 003
Revises: 002
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_verified and auth_provider to users table.
    # Existing users default to is_verified=TRUE so they can still log in.
    op.add_column(
        "users",
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "users",
        sa.Column("auth_provider", sa.String(20), nullable=False, server_default="local"),
    )

    # Allow phone and password_hash to be NULL for social-auth users
    op.alter_column("users", "phone", nullable=True)
    op.alter_column("users", "password_hash", nullable=True)

    # Create email_verifications table
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_verifications_user_id", "email_verifications", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_email_verifications_user_id", table_name="email_verifications")
    op.drop_table("email_verifications")
    op.alter_column("users", "password_hash", nullable=False)
    op.alter_column("users", "phone", nullable=False)
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "is_verified")
