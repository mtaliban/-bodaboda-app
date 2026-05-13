import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, Enum as SAEnum, TIMESTAMP, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ResetMethod(str, enum.Enum):
    EMAIL = "email"
    SMS = "sms"


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    reset_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    method: Mapped[ResetMethod] = mapped_column(
        SAEnum(
            ResetMethod,
            name="resetmethod",
            values_callable=lambda obj: [e.value for e in obj],
            create_type=False,
        ),
        nullable=False,
    )
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
