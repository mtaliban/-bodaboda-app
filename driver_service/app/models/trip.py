import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, String, Enum as SAEnum, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TripStatus(str, enum.Enum):
    SEARCHING_DRIVER = "SEARCHING_DRIVER"
    REQUESTED = "REQUESTED"
    DRIVER_ASSIGNED = "DRIVER_ASSIGNED"
    DRIVER_ARRIVED = "DRIVER_ARRIVED"
    NO_DRIVER_AVAILABLE = "NO_DRIVER_AVAILABLE"
    CANCELLED = "CANCELLED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class RideType(str, enum.Enum):
    BODA = "BODA"


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rider_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    driver_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("drivers.id"), nullable=True)
    pickup_address: Mapped[str] = mapped_column(String(500), nullable=False)
    pickup_lat: Mapped[Optional[float]] = mapped_column(nullable=True)
    pickup_lng: Mapped[Optional[float]] = mapped_column(nullable=True)
    destination_address: Mapped[str] = mapped_column(String(500), nullable=False)
    destination_lat: Mapped[Optional[float]] = mapped_column(nullable=True)
    destination_lng: Mapped[Optional[float]] = mapped_column(nullable=True)
    ride_type: Mapped[RideType] = mapped_column(SAEnum(RideType, name="ridetype"), nullable=False, default=RideType.BODA)
    payment_method: Mapped[PaymentMethod] = mapped_column(SAEnum(PaymentMethod, name="paymentmethod"), nullable=False, default=PaymentMethod.CASH)
    status: Mapped[TripStatus] = mapped_column(SAEnum(TripStatus, name="tripstatus"), nullable=False, default=TripStatus.SEARCHING_DRIVER)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False)
