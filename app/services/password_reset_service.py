import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, hash_token
from app.models.password_reset_token import PasswordResetToken, ResetMethod
from app.models.user import User
from app.services.email_service import EmailService

_CODE_EXPIRY_MINUTES = 10
_RESET_TOKEN_EXPIRY_MINUTES = 15


class PasswordResetService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _find_user(self, email_or_phone: str) -> Optional[User]:
        result = await self.db.execute(
            select(User).where(
                (User.email == email_or_phone) | (User.phone == email_or_phone)
            )
        )
        return result.scalar_one_or_none()

    async def initiate_reset(self, email_or_phone: str, method: ResetMethod) -> str:
        user = await self._find_user(email_or_phone)

        # Avoid user enumeration — always return the same vague message
        if not user:
            return "If that account exists, a code has been sent"

        # Invalidate previous unused reset codes
        old = await self.db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.is_used.is_(False),
                PasswordResetToken.is_verified.is_(False),
            )
        )
        for rec in old.scalars().all():
            rec.is_used = True

        # Generate 6-digit code and store its hash
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_CODE_EXPIRY_MINUTES)

        record = PasswordResetToken(
            user_id=user.id,
            code_hash=hash_token(code),
            method=ResetMethod.EMAIL,
            expires_at=expires_at,
        )
        self.db.add(record)
        await self.db.commit()

        # Always send via email (SMS not configured)
        try:
            await EmailService.send_reset_code(
                to_email=user.email,
                full_name=user.full_name,
                code=code,
            )
            masked = _mask_email(user.email)
            return f"Reset code sent to {masked}"
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to send reset code: {exc}",
            )

    async def verify_code(self, email_or_phone: str, code: str) -> str:
        user = await self._find_user(email_or_phone)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset code",
            )

        result = await self.db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.code_hash == hash_token(code),
                PasswordResetToken.is_verified.is_(False),
                PasswordResetToken.is_used.is_(False),
                PasswordResetToken.expires_at > datetime.now(timezone.utc),
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset code",
            )

        # Code is valid — issue a short-lived reset token
        raw_reset_token = secrets.token_urlsafe(32)
        record.reset_token_hash = hash_token(raw_reset_token)
        record.is_verified = True
        record.expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=_RESET_TOKEN_EXPIRY_MINUTES)
        )
        await self.db.commit()

        return raw_reset_token

    async def reset_password(self, reset_token: str, new_password: str) -> None:
        result = await self.db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.reset_token_hash == hash_token(reset_token),
                PasswordResetToken.is_verified.is_(True),
                PasswordResetToken.is_used.is_(False),
                PasswordResetToken.expires_at > datetime.now(timezone.utc),
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset token",
            )

        user_result = await self.db.execute(
            select(User).where(User.id == record.user_id)
        )
        user = user_result.scalar_one()

        user.password_hash = hash_password(new_password)
        record.is_used = True
        await self.db.commit()


def _mask_email(email: str) -> str:
    local, domain = email.split("@", 1)
    return f"{local[:2]}***@{domain}"


def _mask_phone(phone: str) -> str:
    return f"{phone[:4]}****{phone[-2:]}"
