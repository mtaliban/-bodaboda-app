import enum
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import BigInteger, String, Text, Boolean, Enum as SAEnum, TIMESTAMP, func
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
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, name="userrole"), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus, name="userstatus"),
        nullable=False,
        default=UserStatus.active,
    )
    # auth_provider: "local" | "google" | "apple"
    auth_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="local")
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    profile_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=_utcnow,
        nullable=False,
    )

    rider_profile: Mapped[Optional["RiderProfile"]] = relationship(
        "RiderProfile", back_populates="user", uselist=False, lazy="noload"
    )
    driver_profile: Mapped[Optional["DriverProfile"]] = relationship(
        "DriverProfile", back_populates="user", uselist=False, lazy="noload"
    )
    refresh_tokens: Mapped[List["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", lazy="noload"
    )
