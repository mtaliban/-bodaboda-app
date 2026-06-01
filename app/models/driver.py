import enum
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import BigInteger, ForeignKey, String, Enum as SAEnum, TIMESTAMP, DECIMAL, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.driver_trip_offer import DriverTripOffer
    from app.models.trip import Trip


class DriverStatus(str, enum.Enum):
    OFFLINE = "OFFLINE"
    AVAILABLE = "AVAILABLE"
    BUSY = "BUSY"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False, index=True
    )
    driver_profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("driver_profiles.id"), unique=True, nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vehicle_model: Mapped[str] = mapped_column(String(100), nullable=False)
    plate_number: Mapped[str] = mapped_column(String(20), nullable=False)
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="VERIFIED")
    status: Mapped[DriverStatus] = mapped_column(
        SAEnum(DriverStatus, name="driverstatus"),
        nullable=False,
        default=DriverStatus.OFFLINE,
    )
    rating: Mapped[Decimal] = mapped_column(DECIMAL(3, 2), nullable=False, default=Decimal("5.00"))
    total_trips: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_lat: Mapped[Optional[float]] = mapped_column(sa.Float, nullable=True, default=None)
    current_lng: Mapped[Optional[float]] = mapped_column(sa.Float, nullable=True, default=None)
    current_trip_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("trips.id"), nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    offers: Mapped[List["DriverTripOffer"]] = relationship(
        "DriverTripOffer", back_populates="driver", lazy="noload"
    )
    current_trip: Mapped[Optional["Trip"]] = relationship(
        "Trip",
        foreign_keys="[Driver.current_trip_id]",
        lazy="noload",
        viewonly=True,
    )
