import enum
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, String, Boolean, Enum as SAEnum, TIMESTAMP, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class UserRole(str, enum.Enum):
    RIDER = "RIDER"
    DRIVER = "DRIVER"


class UserStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, name="userrole"), nullable=False)
    status: Mapped[UserStatus] = mapped_column(SAEnum(UserStatus, name="userstatus"), nullable=False, default=UserStatus.active)
    auth_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="local")
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    profile_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    wallet_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False)

    driver_profile: Mapped[Optional["DriverProfile"]] = relationship(
        "DriverProfile", back_populates="user", uselist=False, lazy="noload"
    )
