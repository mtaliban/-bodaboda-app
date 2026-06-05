from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from app.models.driver import DriverStatus
from app.models.trip import TripStatus


class DriverStatusUpdate(BaseModel):
    status: DriverStatus


class LocationUpdate(BaseModel):
    trip_id: Optional[int] = None
    lat: float
    lng: float


class TripOut(BaseModel):
    id: int
    rider_id: int
    driver_id: Optional[int]
    pickup_address: str
    pickup_lat: Optional[float]
    pickup_lng: Optional[float]
    destination_address: str
    destination_lat: Optional[float]
    destination_lng: Optional[float]
    ride_type: str
    payment_method: str
    status: TripStatus
    fare_tzs: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DriverOut(BaseModel):
    id: int
    user_id: int
    full_name: str
    vehicle_model: str
    plate_number: str
    status: DriverStatus
    rating: float
    total_trips: int

    model_config = {"from_attributes": True}
