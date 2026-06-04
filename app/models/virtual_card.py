from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, String, TIMESTAMP, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class VirtualCard(Base):
    __tablename__ = "virtual_cards"
    __table_args__ = (UniqueConstraint("user_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    card_number: Mapped[str] = mapped_column(String(19), nullable=False)
    expiry_month: Mapped[int] = mapped_column(Integer, nullable=False)
    expiry_year: Mapped[int] = mapped_column(Integer, nullable=False)
    cvv: Mapped[str] = mapped_column(String(3), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
