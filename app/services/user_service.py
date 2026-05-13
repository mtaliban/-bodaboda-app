from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User, UserRole
from app.models.driver_profile import DriverProfile
from app.schemas.user import UserUpdate
from app.schemas.profile import DriverProfileUpdate


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_user_with_profile(self, user_id: int) -> User | None:
        result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
        )
        return result.scalar_one_or_none()

    async def update_user(self, user: User, data: UserUpdate) -> User:
        fields_set = data.model_fields_set

        if "full_name" in fields_set and data.full_name is not None:
            user.full_name = data.full_name

        if "email" in fields_set and data.email is not None:
            email_str = str(data.email)
            if email_str != user.email:
                conflict = await self.db.execute(
                    select(User).where(User.email == email_str, User.id != user.id)
                )
                if conflict.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Email already in use",
                    )
                user.email = email_str

        if "phone" in fields_set and data.phone is not None:
            if data.phone != user.phone:
                conflict = await self.db.execute(
                    select(User).where(User.phone == data.phone, User.id != user.id)
                )
                if conflict.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Phone already in use",
                    )
                user.phone = data.phone

        if "profile_image_url" in fields_set:
            user.profile_image_url = data.profile_image_url

        await self.db.commit()
        return user

    async def update_driver_profile(self, user: User, data: DriverProfileUpdate) -> DriverProfile:
        if user.role != UserRole.DRIVER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a driver account",
            )

        result = await self.db.execute(
            select(DriverProfile).where(DriverProfile.user_id == user.id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Driver profile not found",
            )

        if data.license_number is not None:
            profile.license_number = data.license_number
        if data.vehicle_model is not None:
            profile.vehicle_model = data.vehicle_model
        if data.plate_number is not None:
            profile.plate_number = data.plate_number

        await self.db.commit()
        await self.db.refresh(profile)
        return profile
