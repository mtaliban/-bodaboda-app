import math as _math

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.trip import TripRequest, TripOut, build_trip_out
from app.services.trip_service import TripService

router = APIRouter()


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = _math.radians(lat2 - lat1)
    dlng = _math.radians(lng2 - lng1)
    a = _math.sin(dlat/2)**2 + _math.cos(_math.radians(lat1)) * _math.cos(_math.radians(lat2)) * _math.sin(dlng/2)**2
    return R * 2 * _math.asin(_math.sqrt(a))


@router.get("/trips/estimate")
async def estimate_trip(
    pickup_lat: float,
    pickup_lng: float,
    dest_lat: float,
    dest_lng: float,
):
    km = _haversine_km(pickup_lat, pickup_lng, dest_lat, dest_lng)
    km = round(km, 2)
    eta_min = max(1, round(km / 25 * 60))
    fare = max(1500, round(1000 + 400 * km, -1))
    return {"distance_km": km, "eta_minutes": eta_min, "fare_tzs": int(fare)}


@router.post("/request", response_model=TripOut, status_code=201)
async def request_trip(
    data: TripRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.request_trip(current_user, data)
    return build_trip_out(trip)


@router.get("/my", response_model=list[TripOut])
async def my_trips(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trips = await svc.get_rider_trips(current_user)
    return [build_trip_out(t) for t in trips]


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.get_trip_detail(current_user, trip_id)
    return build_trip_out(trip)


@router.post("/{trip_id}/cancel", response_model=TripOut)
async def cancel_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.cancel_trip(current_user, trip_id)
    return build_trip_out(trip)


@router.post("/{trip_id}/driver-arrived", response_model=TripOut)
async def driver_arrived(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.driver_arrived(current_user, trip_id)
    return build_trip_out(trip)


@router.post("/{trip_id}/start", response_model=TripOut)
async def start_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.start_trip(current_user, trip_id)
    return build_trip_out(trip)


@router.post("/{trip_id}/complete", response_model=TripOut)
async def complete_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TripService(db)
    trip = await svc.complete_trip(current_user, trip_id)
    return build_trip_out(trip)
