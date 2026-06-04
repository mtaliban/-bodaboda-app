from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole, UserStatus
from app.schemas.profile import RiderProfileOut, DriverProfileOut


class UserOut(BaseModel):
    id: int
    full_name: str
    phone: Optional[str]
    email: str
    role: UserRole
    status: UserStatus
    auth_provider: str = "local"
    is_verified: bool = False
    profile_image_url: Optional[str]
    wallet_balance: Decimal = Decimal("0")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserWithProfile(UserOut):
    rider_profile: Optional[RiderProfileOut] = None
    driver_profile: Optional[DriverProfileOut] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    profile_image_url: Optional[str] = None
