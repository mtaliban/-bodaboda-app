from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import generate_refresh_token, hash_token
from app.models.refresh_token import RefreshToken


class TokenService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_refresh_token(self, user_id: int) -> str:
        raw_token = generate_refresh_token()
        token_hash = hash_token(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        record = RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self.db.add(record)
        await self.db.commit()
        return raw_token

    async def get_valid_token(self, raw_token: str) -> RefreshToken | None:
        token_hash = hash_token(raw_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked.is_(False),
                RefreshToken.expires_at > datetime.now(timezone.utc),
            )
        )
        return result.scalar_one_or_none()

    async def revoke_token(self, raw_token: str) -> bool:
        token_hash = hash_token(raw_token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        record = result.scalar_one_or_none()
        if not record:
            return False
        record.revoked = True
        await self.db.commit()
        return True
