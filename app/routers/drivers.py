from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.driver import Driver
from app.models.driver_profile import DriverProfile
from app.models.rider_profile import RiderProfile
from app.models.trip import Trip, TripStatus
from app.models.user import User, UserRole
from app.schemas.driver import DriverOut, OfferOut, AcceptOfferResponse, DeclineOfferResponse
from app.schemas.trip import TripOut, build_trip_out
from app.services.driver_service import DriverService

router = APIRouter()


@router.post("/sync-me", response_model=DriverOut)
async def sync_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    driver = await svc.sync_driver(current_user)
    return DriverOut.model_validate(driver)


@router.post("/go-online", response_model=DriverOut)
async def go_online(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    driver = await svc.go_online(current_user)
    return DriverOut.model_validate(driver)


@router.post("/go-offline", response_model=DriverOut)
async def go_offline(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    driver = await svc.go_offline(current_user)
    return DriverOut.model_validate(driver)


@router.get("/me", response_model=DriverOut)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    driver = await svc.get_driver_me(current_user)
    return DriverOut.model_validate(driver)


@router.get("/current-trip", response_model=Optional[TripOut])
async def get_current_trip(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    trip = await svc.get_current_trip(current_user)
    if trip is None:
        return None
    return build_trip_out(trip)


@router.get("/offers/current", response_model=Optional[OfferOut])
async def get_current_offer(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    offer = await svc.get_current_offer(current_user)
    if offer is None:
        return None

    offer_out = OfferOut.model_validate(offer)

    # Enrich with rider contact info
    if offer.trip is not None:
        rider_id = offer.trip.rider_id
        # rider_id on Trip references rider_profiles.id
        rider_profile_result = await db.execute(
            select(RiderProfile).where(RiderProfile.id == rider_id)
        )
        rider_profile = rider_profile_result.scalar_one_or_none()
        if rider_profile is not None:
            user_result = await db.execute(
                select(User).where(User.id == rider_profile.user_id)
            )
            rider_user = user_result.scalar_one_or_none()
            if rider_user is not None:
                offer_out.rider_name = rider_user.full_name
                offer_out.rider_phone = rider_user.phone

    return offer_out


@router.get("/offers/history", response_model=list[OfferOut])
async def get_offer_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    offers = await svc.get_offer_history(current_user)
    return [OfferOut.model_validate(o) for o in offers]


@router.post("/offers/{offer_id}/accept", response_model=AcceptOfferResponse)
async def accept_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    result = await svc.accept_offer(current_user, offer_id)

    trip = result["trip"]
    trip_out = TripOut(
        id=trip.id,
        rider_id=trip.rider_id,
        driver_id=trip.driver_id,
        pickup_address=trip.pickup_address,
        destination_address=trip.destination_address,
        ride_type=trip.ride_type,
        payment_method=trip.payment_method,
        status=trip.status,
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )

    return AcceptOfferResponse(
        message="Trip accepted successfully",
        offer=OfferOut.model_validate(result["offer"]),
        trip=trip_out.model_dump(),
        driver=DriverOut.model_validate(result["driver"]),
        next_action="Go to pickup location",
    )


@router.get("/trips", response_model=list[TripOut])
async def get_driver_trips(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != UserRole.DRIVER:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Drivers only")

    profile_result = await db.execute(
        select(DriverProfile).where(DriverProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return []

    driver_result = await db.execute(
        select(Driver).where(Driver.driver_profile_id == profile.id)
    )
    driver = driver_result.scalar_one_or_none()
    if not driver:
        return []

    result = await db.execute(
        select(Trip)
        .where(Trip.driver_id == driver.id)
        .order_by(Trip.created_at.desc())
    )
    trips = result.scalars().all()
    return [build_trip_out(t) for t in trips]


@router.post("/offers/{offer_id}/decline", response_model=DeclineOfferResponse)
async def decline_offer(
    offer_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = DriverService(db)
    result = await svc.decline_offer(current_user, offer_id)
    return DeclineOfferResponse(
        message="Offer declined",
        offer=OfferOut.model_validate(result["offer"]),
        next_action=result["next_action"],
    )
