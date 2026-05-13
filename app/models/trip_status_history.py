import enum
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, String, Text, Enum as SAEnum, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.trip import Trip


class ChangedBy(str, enum.Enum):
    RIDER = "RIDER"
    DRIVER = "DRIVER"
    SYSTEM = "SYSTEM"


class TripStatusHistory(Base):
    __tablename__ = "trip_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trips.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_by: Mapped[ChangedBy] = mapped_column(
        SAEnum(ChangedBy, name="changedby"), nullable=False
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="status_history")
