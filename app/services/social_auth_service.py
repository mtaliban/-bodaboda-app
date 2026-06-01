from typing import Optional

import httpx
from fastapi import HTTPException, status
from jose import jwt, jwk
from jose.exceptions import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import create_access_token
from app.models.driver_profile import DriverProfile
from app.models.rider_profile import RiderProfile
from app.models.user import User, UserRole, UserStatus
from app.schemas.auth import SocialDriverProfile
from app.services.token_service import TokenService


class SocialAuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.token_service = TokenService(db)

    # ── Google ────────────────────────────────────────────────────────────────

    async def verify_google_token(self, id_token: str) -> dict:
        """Verify Google ID token via Google's tokeninfo endpoint."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": id_token},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")

        data = resp.json()
        if "error" in data:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")

        # If GOOGLE_CLIENT_ID is set, verify the audience matches
        if settings.GOOGLE_CLIENT_ID and data.get("aud") != settings.GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token audience mismatch")

        return data  # contains: email, name, sub, picture, email_verified

    # ── Apple ─────────────────────────────────────────────────────────────────

    async def verify_apple_token(self, identity_token: str) -> dict:
        """Verify Apple identity token using Apple's public JWKS."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://appleid.apple.com/auth/keys")
            resp.raise_for_status()
            keys_data = resp.json()

        try:
            header = jwt.get_unverified_header(identity_token)
        except JWTError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Apple token format")

        kid = header.get("kid")
        alg = header.get("alg", "RS256")

        matching_key = next((k for k in keys_data["keys"] if k["kid"] == kid), None)
        if not matching_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Apple token key not found")

        try:
            public_key = jwk.construct(matching_key, algorithm=alg)
            options = {"verify_aud": bool(settings.APPLE_APP_ID)}
            claims = jwt.decode(
                identity_token,
                public_key.to_dict(),
                algorithms=[alg],
                audience=settings.APPLE_APP_ID or None,
                issuer="https://appleid.apple.com",
                options=options,
            )
            return claims  # contains: sub (Apple user ID), email
        except JWTError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Apple token: {exc}")

    # ── Common: find-or-create user, return JWT pair ──────────────────────────

    async def get_or_create_user(
        self,
        email: str,
        full_name: str,
        provider: str,
        role: UserRole,
        phone: Optional[str] = None,
        driver_profile_data: Optional[SocialDriverProfile] = None,
    ) -> tuple[User, str, str]:
        result = await self.db.execute(
            select(User)
            .where(User.email == email)
            .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
        )
        user = result.scalar_one_or_none()

        if user:
            # Existing user — just log them in, update provider if needed
            if user.auth_provider == "local":
                user.auth_provider = provider
            if not user.is_verified:
                user.is_verified = True
            await self.db.commit()
            await self.db.refresh(user)
            # Re-load relationships
            result2 = await self.db.execute(
                select(User)
                .where(User.id == user.id)
                .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
            )
            user = result2.scalar_one()
        else:
            # New user — create account (already verified via social provider)
            user = User(
                full_name=full_name,
                email=email,
                phone=phone,
                password_hash=None,
                role=role,
                status=UserStatus.active,
                auth_provider=provider,
                is_verified=True,
            )
            self.db.add(user)
            await self.db.flush()

            if role == UserRole.RIDER:
                self.db.add(RiderProfile(user_id=user.id))
            else:
                if not driver_profile_data:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="driver_profile is required when role is DRIVER",
                    )
                self.db.add(DriverProfile(
                    user_id=user.id,
                    license_number=driver_profile_data.license_number,
                    vehicle_model=driver_profile_data.vehicle_model,
                    plate_number=driver_profile_data.plate_number,
                ))

            await self.db.commit()

            result3 = await self.db.execute(
                select(User)
                .where(User.id == user.id)
                .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
            )
            user = result3.scalar_one()

        return user, *await self._issue_tokens(user)

    async def _issue_tokens(self, user: User) -> tuple[str, str]:
        payload: dict = {"sub": str(user.id), "role": user.role.value}
        if user.role == UserRole.RIDER and user.rider_profile:
            payload["rider_profile_id"] = user.rider_profile.id
        elif user.role == UserRole.DRIVER and user.driver_profile:
            payload["driver_profile_id"] = user.driver_profile.id

        access_token = create_access_token(payload)
        refresh_token = await self.token_service.create_refresh_token(user.id)
        return access_token, refresh_token
