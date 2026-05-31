from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.driver import Driver, DriverStatus
from app.models.driver_profile import DriverProfile
from app.models.trip import Trip, TripStatus
from app.models.trip import RideType, PaymentMethod
from app.schemas.driver import DriverOut, TripOut, DriverStatusUpdate, LocationUpdate
from app.services import mqtt_publisher

router = APIRouter()


async def _get_driver(user: User, db: AsyncSession) -> Driver:
    if user.role != UserRole.DRIVER:
        raise HTTPException(status_code=403, detail="Only drivers can perform this action")

    profile = await db.execute(
        select(DriverProfile).where(DriverProfile.user_id == user.id)
    )
    dp = profile.scalar_one_or_none()
    if not dp:
        raise HTTPException(status_code=404, detail="Driver profile not found")

    result = await db.execute(
        select(Driver).where(Driver.driver_profile_id == dp.id)
    )
    driver = result.scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver record not found. Call POST /driver/sync first.")
    return driver


# ── GET /driver/me ────────────────────────────────────────────────────────────
@router.get("/me", response_model=DriverOut)
async def get_my_driver_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)
    return DriverOut(
        id=driver.id,
        user_id=driver.user_id,
        full_name=driver.full_name,
        vehicle_model=driver.vehicle_model,
        plate_number=driver.plate_number,
        status=driver.status,
        rating=float(driver.rating),
        total_trips=driver.total_trips,
    )


# ── POST /driver/status ───────────────────────────────────────────────────────
@router.post("/status", response_model=DriverOut)
async def update_status(
    body: DriverStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)
    driver.status = body.status
    await db.commit()
    await db.refresh(driver)
    return DriverOut(
        id=driver.id,
        user_id=driver.user_id,
        full_name=driver.full_name,
        vehicle_model=driver.vehicle_model,
        plate_number=driver.plate_number,
        status=driver.status,
        rating=float(driver.rating),
        total_trips=driver.total_trips,
    )


# ── GET /driver/trips/pending ─────────────────────────────────────────────────
@router.get("/trips/pending", response_model=list[TripOut])
async def get_pending_trips(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_driver(current_user, db)
    result = await db.execute(
        select(Trip)
        .where(Trip.status == TripStatus.SEARCHING_DRIVER)
        .order_by(Trip.created_at.desc())
    )
    trips = result.scalars().all()
    return [TripOut.model_validate(t) for t in trips]


# ── GET /driver/trips/my ──────────────────────────────────────────────────────
@router.get("/trips/my", response_model=list[TripOut])
async def get_my_trips(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)
    result = await db.execute(
        select(Trip)
        .where(Trip.driver_id == driver.id)
        .order_by(Trip.created_at.desc())
    )
    trips = result.scalars().all()
    return [TripOut.model_validate(t) for t in trips]


# ── POST /driver/trips/{trip_id}/accept ───────────────────────────────────────
@router.post("/trips/{trip_id}/accept", response_model=TripOut)
async def accept_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)

    if driver.status != DriverStatus.AVAILABLE:
        raise HTTPException(status_code=400, detail="You must be AVAILABLE to accept a trip")

    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status != TripStatus.SEARCHING_DRIVER:
        raise HTTPException(status_code=400, detail=f"Trip is no longer available (status: {trip.status.value})")

    trip.driver_id = driver.id
    trip.status = TripStatus.DRIVER_ASSIGNED
    driver.status = DriverStatus.BUSY
    driver.current_trip_id = trip.id
    await db.commit()
    await db.refresh(trip)

    # Publish MQTT event → Rider gets real-time update
    await mqtt_publisher.publish_ride_accepted(
        trip_id=trip.id,
        driver_id=driver.id,
        driver_name=driver.full_name,
        driver_phone=current_user.phone or "",
        vehicle=driver.vehicle_model,
        plate=driver.plate_number,
    )

    return TripOut.model_validate(trip)


# ── POST /driver/trips/{trip_id}/arrived ──────────────────────────────────────
@router.post("/trips/{trip_id}/arrived", response_model=TripOut)
async def driver_arrived(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)

    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip or trip.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    if trip.status != TripStatus.DRIVER_ASSIGNED:
        raise HTTPException(status_code=400, detail="Trip must be DRIVER_ASSIGNED")

    trip.status = TripStatus.DRIVER_ARRIVED
    await db.commit()
    await db.refresh(trip)

    await mqtt_publisher.publish_driver_arrived(trip_id=trip.id, driver_name=driver.full_name)
    return TripOut.model_validate(trip)


# ── POST /driver/trips/{trip_id}/start ────────────────────────────────────────
@router.post("/trips/{trip_id}/start", response_model=TripOut)
async def start_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)

    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip or trip.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    if trip.status not in (TripStatus.DRIVER_ARRIVED, TripStatus.DRIVER_ASSIGNED):
        raise HTTPException(status_code=400, detail="Trip must be DRIVER_ARRIVED or DRIVER_ASSIGNED")

    trip.status = TripStatus.IN_PROGRESS
    await db.commit()
    await db.refresh(trip)

    await mqtt_publisher.publish_ride_started(trip_id=trip.id)
    return TripOut.model_validate(trip)


# ── POST /driver/trips/{trip_id}/complete ─────────────────────────────────────
@router.post("/trips/{trip_id}/complete", response_model=TripOut)
async def complete_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)

    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip or trip.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    if trip.status != TripStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Trip must be IN_PROGRESS")

    trip.status = TripStatus.COMPLETED
    driver.status = DriverStatus.AVAILABLE
    driver.current_trip_id = None
    driver.total_trips += 1
    await db.commit()
    await db.refresh(trip)

    await mqtt_publisher.publish_ride_completed(trip_id=trip.id)
    return TripOut.model_validate(trip)


# ── POST /driver/trips/{trip_id}/approaching ──────────────────────────────────
@router.post("/trips/{trip_id}/approaching")
async def driver_approaching(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if not trip or trip.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    await mqtt_publisher.publish_driver_approaching(trip_id=trip.id, driver_name=driver.full_name)
    return {"ok": True}


# ── POST /driver/location ─────────────────────────────────────────────────────
@router.post("/location")
async def update_location(
    body: LocationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await _get_driver(current_user, db)
    await mqtt_publisher.publish_driver_location(
        driver_id=driver.id,
        trip_id=body.trip_id,
        lat=body.lat,
        lng=body.lng,
    )
    return {"ok": True}
