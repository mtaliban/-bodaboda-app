from datetime import datetime
from typing import Optional, List, TYPE_CHECKING

from pydantic import BaseModel, field_serializer

from app.models.trip import TripStatus, RideType, PaymentMethod
from app.models.trip_status_history import ChangedBy

if TYPE_CHECKING:
    from app.models.trip import Trip


TRIP_STATUS_MESSAGES: dict[TripStatus, str] = {
    TripStatus.SEARCHING_DRIVER: "Trip request created. Searching for a driver.",
    TripStatus.NO_DRIVER_AVAILABLE: "No driver available right now. Please try again.",
    TripStatus.DRIVER_ASSIGNED: "Driver has been assigned to your trip.",
    TripStatus.DRIVER_ARRIVED: "Your driver has arrived at the pickup location.",
    TripStatus.CANCELLED: "Trip has been cancelled.",
    TripStatus.IN_PROGRESS: "Trip is in progress.",
    TripStatus.COMPLETED: "Trip completed.",
    TripStatus.REQUESTED: "Trip requested.",
}


class TripRequest(BaseModel):
    pickup_address: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    destination_address: str
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    ride_type: RideType = RideType.BODA
    payment_method: PaymentMethod = PaymentMethod.CASH


class TripStatusHistoryOut(BaseModel):
    id: int
    status: str
    changed_by: ChangedBy
    note: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class DriverSummary(BaseModel):
    id: int
    full_name: str
    vehicle_model: str
    plate_number: str
    rating: float

    model_config = {"from_attributes": True}

    @field_serializer("rating")
    def serialize_rating(self, v: float) -> float:
        return round(float(v), 2)


class TripOut(BaseModel):
    id: int
    trip_name: Optional[str] = None
    rider_id: int
    driver_id: Optional[int] = None
    pickup_address: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    destination_address: str
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    ride_type: RideType
    payment_method: PaymentMethod
    status: TripStatus
    fare_tzs: Optional[int] = None
    message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    assigned_driver: Optional[DriverSummary] = None
    status_history: Optional[List[TripStatusHistoryOut]] = None

    model_config = {"from_attributes": True}


def build_trip_out(trip: "Trip") -> TripOut:
    driver_summary = None
    if trip.assigned_driver is not None:
        d = trip.assigned_driver
        driver_summary = DriverSummary(
            id=d.id,
            full_name=d.full_name,
            vehicle_model=d.vehicle_model,
            plate_number=d.plate_number,
            rating=float(d.rating),
        )

    history = None
    try:
        raw = trip.status_history
        if raw is not None:
            history = sorted(
                [TripStatusHistoryOut.model_validate(h) for h in raw],
                key=lambda h: h.created_at,
            )
    except Exception:
        history = None

    return TripOut(
        id=trip.id,
        trip_name=trip.trip_name,
        rider_id=trip.rider_id,
        driver_id=trip.driver_id,
        pickup_address=trip.pickup_address,
        pickup_lat=trip.pickup_lat,
        pickup_lng=trip.pickup_lng,
        destination_address=trip.destination_address,
        destination_lat=trip.destination_lat,
        destination_lng=trip.destination_lng,
        ride_type=trip.ride_type,
        payment_method=trip.payment_method,
        status=trip.status,
        fare_tzs=trip.fare_tzs,
        message=TRIP_STATUS_MESSAGES.get(trip.status, ""),
        created_at=trip.created_at,
        updated_at=trip.updated_at,
        assigned_driver=driver_summary,
        status_history=history,
    )
