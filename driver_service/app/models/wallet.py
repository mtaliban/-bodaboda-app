from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, String, Numeric, TIMESTAMP, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    trip_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("trips.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
