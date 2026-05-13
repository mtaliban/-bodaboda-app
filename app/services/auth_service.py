from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User, UserRole, UserStatus
from app.models.rider_profile import RiderProfile
from app.models.driver_profile import DriverProfile
from app.schemas.auth import RegisterRequest, LoginRequest
from app.services.token_service import TokenService


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.token_service = TokenService(db)

    async def register(self, data: RegisterRequest) -> User:
        result = await self.db.execute(
            select(User).where(
                (User.email == str(data.email)) | (User.phone == data.phone)
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email or phone already registered",
            )

        user = User(
            full_name=data.full_name,
            phone=data.phone,
            email=str(data.email),
            password_hash=hash_password(data.password),
            role=data.role,
            status=UserStatus.active,
        )
        self.db.add(user)
        await self.db.flush()

        if data.role == UserRole.RIDER:
            self.db.add(RiderProfile(user_id=user.id))
        else:
            self.db.add(
                DriverProfile(
                    user_id=user.id,
                    license_number=data.driver_profile.license_number,
                    vehicle_model=data.driver_profile.vehicle_model,
                    plate_number=data.driver_profile.plate_number,
                )
            )

        await self.db.commit()

        result = await self.db.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
        )
        return result.scalar_one()

    async def login(self, data: LoginRequest) -> tuple[User, str, str]:
        result = await self.db.execute(
            select(User)
            .where((User.email == data.email_or_phone) | (User.phone == data.email_or_phone))
            .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
        )
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        if user.status == UserStatus.suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account suspended",
            )

        payload: dict = {"sub": str(user.id), "role": user.role.value}
        if user.role == UserRole.RIDER and user.rider_profile:
            payload["rider_profile_id"] = user.rider_profile.id
        elif user.role == UserRole.DRIVER and user.driver_profile:
            payload["driver_profile_id"] = user.driver_profile.id

        access_token = create_access_token(payload)
        refresh_token = await self.token_service.create_refresh_token(user.id)

        return user, access_token, refresh_token
