import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, Enum as SAEnum, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.trip import Trip
    from app.models.driver import Driver


class OfferStatus(str, enum.Enum):
    OFFERED = "OFFERED"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DriverTripOffer(Base):
    __tablename__ = "driver_trip_offers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trips.id"), nullable=False, index=True
    )
    driver_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("drivers.id"), nullable=False, index=True
    )
    status: Mapped[OfferStatus] = mapped_column(
        SAEnum(OfferStatus, name="offerstatus"),
        nullable=False,
        default=OfferStatus.OFFERED,
    )
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="offers")
    driver: Mapped["Driver"] = relationship("Driver", back_populates="offers")
