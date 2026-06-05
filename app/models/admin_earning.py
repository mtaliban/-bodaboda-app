from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, Numeric, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AdminEarning(Base):
    __tablename__ = "admin_earnings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trip_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
