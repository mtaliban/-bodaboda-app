from typing import Optional

from pydantic import BaseModel, field_serializer
from decimal import Decimal

from app.models.driver_profile import VerificationStatus


class RiderProfileOut(BaseModel):
    id: int
    user_id: int
    rating: float
    total_trips: int

    model_config = {"from_attributes": True}

    @field_serializer("rating")
    def serialize_rating(self, v: float) -> float:
        return round(float(v), 2)


class DriverProfileOut(BaseModel):
    id: int
    user_id: int
    license_number: str
    vehicle_model: str
    plate_number: str
    verification_status: VerificationStatus
    rating: float
    total_trips: int

    model_config = {"from_attributes": True}

    @field_serializer("rating")
    def serialize_rating(self, v: float) -> float:
        return round(float(v), 2)


class DriverProfileCreate(BaseModel):
    license_number: str
    vehicle_model: str
    plate_number: str


class DriverProfileUpdate(BaseModel):
    license_number: Optional[str] = None
    vehicle_model: Optional[str] = None
    plate_number: Optional[str] = None
