import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.models.email_verification import EmailVerification
from app.models.user import User
from app.services.email_service import EmailService

_CODE_EXPIRY_MINUTES = 10


class EmailVerificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def send_code(self, user: User) -> None:
        # Invalidate all previous unused codes so only the new one is valid
        await self.db.execute(
            update(EmailVerification)
            .where(
                EmailVerification.user_id == user.id,
                EmailVerification.is_used.is_(False),
            )
            .values(is_used=True)
        )

        code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_CODE_EXPIRY_MINUTES)

        record = EmailVerification(
            user_id=user.id,
            code_hash=hash_token(code),
            expires_at=expires_at,
        )
        self.db.add(record)
        await self.db.commit()

        try:
            await EmailService.send_verification_code(
                to_email=user.email,
                full_name=user.full_name,
                code=code,
            )
        except Exception as exc:
            import logging
            logging.getLogger("bodaboda.email").warning(
                "Email delivery failed for %s: %s — code is in logs above", user.email, exc
            )

    async def verify_code(self, user_id: int, code: str) -> User:
        # Check if code exists and matches (regardless of expiry)
        result = await self.db.execute(
            select(EmailVerification).where(
                EmailVerification.user_id == user_id,
                EmailVerification.code_hash == hash_token(code),
                EmailVerification.is_used.is_(False),
            )
        )
        record = result.scalar_one_or_none()

        if not record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid code. Please check and try again.",
            )

        if record.expires_at < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Code expired. Please request a new one.",
            )

        record.is_used = True

        user_result = await self.db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")

        user.is_verified = True
        await self.db.commit()
        return user
