from typing import Optional, Union

from fastapi import APIRouter, Depends, Body
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.schemas.user import UserWithProfile, UserUpdate
from app.schemas.profile import RiderProfileOut, DriverProfileOut, DriverProfileUpdate
from app.services.user_service import UserService

router = APIRouter()


@router.get("/me", response_model=UserWithProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserWithProfile.model_validate(current_user)


@router.put("/me", response_model=UserWithProfile)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = UserService(db)
    await service.update_user(current_user, data)
    user = await service.get_user_with_profile(current_user.id)
    return UserWithProfile.model_validate(user)


@router.put("/me/profile", response_model=Union[RiderProfileOut, DriverProfileOut])
async def update_profile(
    data: Optional[DriverProfileUpdate] = Body(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = UserService(db)

    if current_user.role == UserRole.RIDER:
        user = await service.get_user_with_profile(current_user.id)
        return RiderProfileOut.model_validate(user.rider_profile)

    profile = await service.update_driver_profile(current_user, data or DriverProfileUpdate())
    return DriverProfileOut.model_validate(profile)
