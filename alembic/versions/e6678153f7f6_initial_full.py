"""initial full schema

Revision ID: e6678153f7f6
Revises:
Create Date: 2026-04-28

Circular FK fix:
  trips.driver_id  → drivers.id
  drivers.current_trip_id → trips.id

Resolution:
  1. Create trips WITHOUT driver_id
  2. Create drivers WITH current_trip_id
  3. ALTER TABLE trips ADD COLUMN driver_id (FK → drivers)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision = "e6678153f7f6"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Enum types ──────────────────────────────────────────────────────────
    # PostgreSQL has no CREATE TYPE IF NOT EXISTS. DO blocks catch
    # duplicate_object so migration is safe when the app pre-created them.
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE userrole AS ENUM ('RIDER', 'DRIVER');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE userstatus AS ENUM ('active', 'suspended');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE verificationstatus AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE tripstatus AS ENUM (
                'SEARCHING_DRIVER', 'REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED',
                'NO_DRIVER_AVAILABLE', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE ridetype AS ENUM ('BODA');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE paymentmethod AS ENUM ('CASH');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE driverstatus AS ENUM ('OFFLINE', 'AVAILABLE', 'BUSY');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE offerstatus AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE changedby AS ENUM ('RIDER', 'DRIVER', 'SYSTEM');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """))

    # ── users ────────────────────────────────────────────────────────────────
    # PGEnum(name=..., create_type=False) references the already-created type
    # without emitting a second CREATE TYPE during op.create_table.
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", PGEnum(name="userrole", create_type=False), nullable=False),
        sa.Column("status", PGEnum(name="userstatus", create_type=False), nullable=False, server_default="active"),
        sa.Column("profile_image_url", sa.String(500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)

    # ── rider_profiles ───────────────────────────────────────────────────────
    op.create_table(
        "rider_profiles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("rating", sa.DECIMAL(3, 2), nullable=False, server_default="5.00"),
        sa.Column("total_trips", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )

    # ── driver_profiles ──────────────────────────────────────────────────────
    op.create_table(
        "driver_profiles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("license_number", sa.String(100), nullable=False),
        sa.Column("vehicle_model", sa.String(100), nullable=False),
        sa.Column("plate_number", sa.String(20), nullable=False),
        sa.Column("verification_status", PGEnum(name="verificationstatus", create_type=False), nullable=False, server_default="VERIFIED"),
        sa.Column("rating", sa.DECIMAL(3, 2), nullable=False, server_default="5.00"),
        sa.Column("total_trips", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )

    # ── refresh_tokens ───────────────────────────────────────────────────────
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)

    # ── trips (WITHOUT driver_id — added after drivers to break circular FK) ─
    op.create_table(
        "trips",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("rider_id", sa.BigInteger(), nullable=False),
        sa.Column("pickup_address", sa.String(500), nullable=False),
        sa.Column("destination_address", sa.String(500), nullable=False),
        sa.Column("ride_type", PGEnum(name="ridetype", create_type=False), nullable=False, server_default="BODA"),
        sa.Column("payment_method", PGEnum(name="paymentmethod", create_type=False), nullable=False, server_default="CASH"),
        sa.Column("status", PGEnum(name="tripstatus", create_type=False), nullable=False, server_default="SEARCHING_DRIVER"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["rider_id"], ["rider_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trips_rider_id", "trips", ["rider_id"])

    # ── drivers (WITH current_trip_id → trips, now safe since trips exists) ─
    op.create_table(
        "drivers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("driver_profile_id", sa.BigInteger(), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("vehicle_model", sa.String(100), nullable=False),
        sa.Column("plate_number", sa.String(20), nullable=False),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="VERIFIED"),
        sa.Column("status", PGEnum(name="driverstatus", create_type=False), nullable=False, server_default="OFFLINE"),
        sa.Column("rating", sa.DECIMAL(3, 2), nullable=False, server_default="5.00"),
        sa.Column("total_trips", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_trip_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["driver_profile_id"], ["driver_profiles.id"]),
        sa.ForeignKeyConstraint(["current_trip_id"], ["trips.id"], ondelete="SET NULL", name="fk_drivers_current_trip_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("driver_profile_id"),
    )
    op.create_index("ix_drivers_user_id", "drivers", ["user_id"])
    op.create_index("ix_drivers_driver_profile_id", "drivers", ["driver_profile_id"], unique=True)

    # ── trips.driver_id — add now that drivers table exists ──────────────────
    op.add_column("trips", sa.Column("driver_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_trips_driver_id",
        "trips", "drivers",
        ["driver_id"], ["id"],
    )

    # ── driver_trip_offers ───────────────────────────────────────────────────
    op.create_table(
        "driver_trip_offers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("trip_id", sa.BigInteger(), nullable=False),
        sa.Column("driver_id", sa.BigInteger(), nullable=False),
        sa.Column("status", PGEnum(name="offerstatus", create_type=False), nullable=False, server_default="OFFERED"),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_driver_trip_offers_trip_id", "driver_trip_offers", ["trip_id"])
    op.create_index("ix_driver_trip_offers_driver_id", "driver_trip_offers", ["driver_id"])

    # ── trip_status_history ──────────────────────────────────────────────────
    op.create_table(
        "trip_status_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("trip_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(50), nullable=False),
        sa.Column("changed_by", PGEnum(name="changedby", create_type=False), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_status_history_trip_id", "trip_status_history", ["trip_id"])

    # ── notifications ────────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("recipient_role", sa.String(10), nullable=False),
        sa.Column("recipient_profile_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("related_trip_id", sa.BigInteger(), nullable=True),
        sa.Column("related_offer_id", sa.BigInteger(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_recipient_profile_id", "notifications", ["recipient_profile_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("trip_status_history")
    op.drop_table("driver_trip_offers")
    op.drop_constraint("fk_trips_driver_id", "trips", type_="foreignkey")
    op.drop_column("trips", "driver_id")
    op.drop_table("drivers")
    op.drop_table("trips")
    op.drop_table("refresh_tokens")
    op.drop_table("driver_profiles")
    op.drop_table("rider_profiles")
    op.drop_table("users")

    op.execute(sa.text("DROP TYPE IF EXISTS changedby"))
    op.execute(sa.text("DROP TYPE IF EXISTS offerstatus"))
    op.execute(sa.text("DROP TYPE IF EXISTS driverstatus"))
    op.execute(sa.text("DROP TYPE IF EXISTS paymentmethod"))
    op.execute(sa.text("DROP TYPE IF EXISTS ridetype"))
    op.execute(sa.text("DROP TYPE IF EXISTS tripstatus"))
    op.execute(sa.text("DROP TYPE IF EXISTS verificationstatus"))
    op.execute(sa.text("DROP TYPE IF EXISTS userstatus"))
    op.execute(sa.text("DROP TYPE IF EXISTS userrole"))
