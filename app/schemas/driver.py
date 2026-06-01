from datetime import datetime
from typing import Optional, Any

from pydantic import BaseModel, field_serializer

from app.models.driver import DriverStatus
from app.models.driver_trip_offer import OfferStatus
from app.models.trip import TripStatus, RideType, PaymentMethod


class DriverCurrentTripSummary(BaseModel):
    id: int
    pickup_address: str
    destination_address: str
    status: TripStatus

    model_config = {"from_attributes": True}


class DriverOut(BaseModel):
    id: int
    user_id: int
    driver_profile_id: int
    full_name: str
    vehicle_model: str
    plate_number: str
    verification_status: str
    rating: float
    total_trips: int
    status: DriverStatus
    current_trip_id: Optional[int] = None
    current_trip: Optional[DriverCurrentTripSummary] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("rating")
    def serialize_rating(self, v: float) -> float:
        return round(float(v), 2)


class OfferTripSummary(BaseModel):
    id: int
    pickup_address: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    destination_address: str
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    ride_type: RideType
    payment_method: PaymentMethod
    status: TripStatus

    model_config = {"from_attributes": True}


class OfferOut(BaseModel):
    id: int
    trip_id: int
    driver_id: int
    status: OfferStatus
    expires_at: datetime
    created_at: datetime
    updated_at: datetime
    trip: Optional[OfferTripSummary] = None
    rider_name: Optional[str] = None
    rider_phone: Optional[str] = None

    model_config = {"from_attributes": True}


class AcceptOfferResponse(BaseModel):
    message: str
    offer: OfferOut
    trip: Any
    driver: DriverOut
    next_action: str


class DeclineOfferResponse(BaseModel):
    message: str
    offer: OfferOut
    next_action: str
