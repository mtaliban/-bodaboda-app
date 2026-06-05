from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, not_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.driver import Driver, DriverStatus
from app.models.driver_profile import DriverProfile
from app.models.driver_trip_offer import DriverTripOffer, OfferStatus
from app.models.trip import Trip, TripStatus
from app.models.trip_status_history import TripStatusHistory, ChangedBy
from app.models.user import User, UserRole
from app.services.mqtt_service import publish_ride_status, publish_new_offer_to_driver
from app.services.notification_service import NotificationService

OFFER_EXPIRY_SECONDS = 10


class DriverService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notif_svc = NotificationService(db)

    async def _load_auth_profile(self, user: User) -> DriverProfile:
        result = await self.db.execute(
            select(DriverProfile).where(DriverProfile.user_id == user.id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Driver profile not found")
        return profile

    def _require_driver(self, user: User) -> None:
        if user.role != UserRole.DRIVER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only drivers can perform this action",
            )

    async def sync_driver(self, user: User) -> Driver:
        self._require_driver(user)
        auth_profile = await self._load_auth_profile(user)

        result = await self.db.execute(
            select(Driver).where(Driver.driver_profile_id == auth_profile.id)
        )
        driver = result.scalar_one_or_none()

        if driver is None:
            driver = Driver(
                user_id=user.id,
                driver_profile_id=auth_profile.id,
                full_name=user.full_name,
                vehicle_model=auth_profile.vehicle_model,
                plate_number=auth_profile.plate_number,
                verification_status=auth_profile.verification_status.value,
                rating=auth_profile.rating,
                total_trips=auth_profile.total_trips,
                status=DriverStatus.OFFLINE,
            )
            self.db.add(driver)
        else:
            driver.full_name = user.full_name
            driver.vehicle_model = auth_profile.vehicle_model
            driver.plate_number = auth_profile.plate_number
            driver.verification_status = auth_profile.verification_status.value

        await self.db.commit()
        await self.db.refresh(driver)
        return driver

    async def get_driver_or_raise(self, user: User) -> Driver:
        self._require_driver(user)
        auth_profile = await self._load_auth_profile(user)

        result = await self.db.execute(
            select(Driver).where(Driver.driver_profile_id == auth_profile.id)
        )
        driver = result.scalar_one_or_none()
        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver record not found. Call POST /drivers/sync-me first.",
            )
        return driver

    async def get_driver_me(self, user: User) -> Driver:
        """Load driver with current_trip for the GET /drivers/me endpoint."""
        self._require_driver(user)
        auth_profile = await self._load_auth_profile(user)

        result = await self.db.execute(
            select(Driver)
            .where(Driver.driver_profile_id == auth_profile.id)
            .options(selectinload(Driver.current_trip))
        )
        driver = result.scalar_one_or_none()
        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver record not found. Call POST /drivers/sync-me first.",
            )
        return driver

    async def go_online(self, user: User) -> Driver:
        driver = await self.sync_driver(user)
        driver.status = DriverStatus.AVAILABLE
        await self.db.commit()
        await self.db.refresh(driver)
        return driver

    async def go_offline(self, user: User) -> Driver:
        driver = await self.get_driver_or_raise(user)
        if driver.status == DriverStatus.BUSY:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot go offline while on an active trip",
            )
        driver.status = DriverStatus.OFFLINE
        await self.db.commit()
        await self.db.refresh(driver)
        return driver

    async def get_current_offer(self, user: User) -> Optional[DriverTripOffer]:
        driver = await self.get_driver_or_raise(user)

        if driver.status == DriverStatus.BUSY:
            return None

        result = await self.db.execute(
            select(DriverTripOffer)
            .where(
                DriverTripOffer.driver_id == driver.id,
                DriverTripOffer.status == OfferStatus.OFFERED,
                DriverTripOffer.expires_at > datetime.now(timezone.utc),
            )
            .options(selectinload(DriverTripOffer.trip))
            .order_by(DriverTripOffer.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_offer_history(self, user: User) -> list[DriverTripOffer]:
        driver = await self.get_driver_or_raise(user)
        result = await self.db.execute(
            select(DriverTripOffer)
            .where(DriverTripOffer.driver_id == driver.id)
            .options(selectinload(DriverTripOffer.trip))
            .order_by(DriverTripOffer.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_current_trip(self, user: User) -> Optional[Trip]:
        driver = await self.get_driver_or_raise(user)
        if not driver.current_trip_id:
            return None

        result = await self.db.execute(
            select(Trip)
            .where(Trip.id == driver.current_trip_id)
            .options(
                selectinload(Trip.assigned_driver),
                selectinload(Trip.status_history),
            )
        )
        return result.scalar_one_or_none()

    async def accept_offer(self, user: User, offer_id: int) -> dict:
        driver = await self.get_driver_or_raise(user)

        result = await self.db.execute(
            select(DriverTripOffer)
            .where(DriverTripOffer.id == offer_id)
            .options(selectinload(DriverTripOffer.trip))
        )
        offer = result.scalar_one_or_none()
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found")
        if offer.driver_id != driver.id:
            raise HTTPException(status_code=403, detail="This offer does not belong to you")
        if offer.status != OfferStatus.OFFERED:
            raise HTTPException(status_code=400, detail=f"Offer is already {offer.status.value}")

        expires_at = offer.expires_at if offer.expires_at.tzinfo else offer.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            offer.status = OfferStatus.EXPIRED
            await self.db.commit()
            raise HTTPException(status_code=400, detail="Offer has expired")
        if driver.status != DriverStatus.AVAILABLE:
            raise HTTPException(status_code=400, detail="You must be AVAILABLE to accept an offer")

        trip = offer.trip
        if trip.status != TripStatus.SEARCHING_DRIVER:
            raise HTTPException(
                status_code=400,
                detail=f"Trip is no longer available (status: {trip.status.value})",
            )

        # Expire any other pending offers for this trip
        other_result = await self.db.execute(
            select(DriverTripOffer).where(
                DriverTripOffer.trip_id == trip.id,
                DriverTripOffer.id != offer.id,
                DriverTripOffer.status == OfferStatus.OFFERED,
            )
        )
        for other in other_result.scalars().all():
            other.status = OfferStatus.EXPIRED

        offer.status = OfferStatus.ACCEPTED
        driver.status = DriverStatus.BUSY
        driver.current_trip_id = trip.id
        trip.driver_id = driver.id
        trip.status = TripStatus.DRIVER_ASSIGNED

        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.DRIVER_ASSIGNED.value,
            changed_by=ChangedBy.DRIVER,
        ))

        await self.notif_svc.create(
            recipient_role="RIDER",
            recipient_profile_id=trip.rider_id,
            title="Driver assigned",
            message="Your driver is on the way.",
            type="DRIVER_ASSIGNED",
            related_trip_id=trip.id,
            related_offer_id=offer.id,
        )

        await self.db.commit()
        await self.db.refresh(offer)
        await self.db.refresh(driver)
        await self.db.refresh(trip)

        # Reload trip with relationships so the router can call build_trip_out
        full_trip_result = await self.db.execute(
            select(Trip)
            .where(Trip.id == trip.id)
            .options(
                selectinload(Trip.assigned_driver),
                selectinload(Trip.status_history),
            )
        )
        full_trip = full_trip_result.scalar_one()

        await publish_ride_status(trip.id, "DRIVER_ASSIGNED", {
            "driver_id":   driver.id,
            "driver_name": driver.full_name,
            "vehicle":     driver.vehicle_model,
            "plate":       driver.plate_number,
        })

        return {"offer": offer, "trip": full_trip, "driver": driver}

    async def decline_offer(self, user: User, offer_id: int) -> dict:
        driver = await self.get_driver_or_raise(user)

        result = await self.db.execute(
            select(DriverTripOffer)
            .where(DriverTripOffer.id == offer_id)
            .options(selectinload(DriverTripOffer.trip))
        )
        offer = result.scalar_one_or_none()
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found")
        if offer.driver_id != driver.id:
            raise HTTPException(status_code=403, detail="This offer does not belong to you")
        if offer.status != OfferStatus.OFFERED:
            raise HTTPException(status_code=400, detail=f"Offer is already {offer.status.value}")

        offer.status = OfferStatus.DECLINED

        trip = offer.trip
        next_offer = await self._find_next_driver(trip)

        if next_offer:
            next_action = f"Trip offered to another driver (offer #{next_offer.id})"
        else:
            trip.status = TripStatus.NO_DRIVER_AVAILABLE
            self.db.add(TripStatusHistory(
                trip_id=trip.id,
                status=TripStatus.NO_DRIVER_AVAILABLE.value,
                changed_by=ChangedBy.SYSTEM,
            ))
            await self.notif_svc.create(
                recipient_role="RIDER",
                recipient_profile_id=trip.rider_id,
                title="No driver available",
                message="No driver is available right now. Please try again.",
                type="NO_DRIVER_AVAILABLE",
                related_trip_id=trip.id,
            )
            next_action = "No other driver available. Trip marked as NO_DRIVER_AVAILABLE."

        await self.db.commit()
        await self.db.refresh(offer)

        if next_offer:
            await publish_ride_status(trip.id, "SEARCHING_AGAIN", {"trip_id": trip.id})
            await publish_new_offer_to_driver(next_offer.driver_id, trip.id)
        else:
            await publish_ride_status(trip.id, "NO_DRIVER_AVAILABLE", {"trip_id": trip.id})

        return {"offer": offer, "next_action": next_action}

    async def match_driver_for_trip(self, trip: Trip) -> Optional[DriverTripOffer]:
        return await self._find_next_driver(trip)

    async def _find_next_driver(self, trip: Trip) -> Optional[DriverTripOffer]:
        result = await self.db.execute(
            select(DriverTripOffer.driver_id).where(DriverTripOffer.trip_id == trip.id)
        )
        already_offered_ids = [row[0] for row in result.all()]

        query = select(Driver).where(Driver.status == DriverStatus.AVAILABLE)
        if already_offered_ids:
            query = query.where(not_(Driver.id.in_(already_offered_ids)))

        result = await self.db.execute(query)
        candidates = list(result.scalars().all())

        if not candidates:
            return None

        # Sort by proximity to pickup — drivers with no location go last
        next_driver = _nearest_driver(candidates, trip.pickup_lat, trip.pickup_lng)
        return await self._create_offer(trip, next_driver)

    async def _create_offer(self, trip: Trip, driver: Driver) -> DriverTripOffer:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=OFFER_EXPIRY_SECONDS)
        offer = DriverTripOffer(
            trip_id=trip.id,
            driver_id=driver.id,
            status=OfferStatus.OFFERED,
            expires_at=expires_at,
        )
        self.db.add(offer)
        await self.db.flush()

        await self.notif_svc.create(
            recipient_role="DRIVER",
            recipient_profile_id=driver.driver_profile_id,
            title="New trip offer",
            message=f"Trip from {trip.pickup_address} to {trip.destination_address}.",
            type="NEW_TRIP_OFFER",
            related_trip_id=trip.id,
            related_offer_id=offer.id,
        )

        return offer


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return distance in km between two GPS coordinates."""
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _nearest_driver(candidates: list, pickup_lat, pickup_lng) -> "Driver":
    """Return the closest available driver to the pickup point.
    Drivers with no stored location are placed last (treated as very far away)."""
    _BIG = float("inf")

    def distance(driver) -> float:
        if driver.current_lat is None or driver.current_lng is None:
            return _BIG
        if pickup_lat is None or pickup_lng is None:
            return _BIG
        return _haversine_km(pickup_lat, pickup_lng, driver.current_lat, driver.current_lng)

    return min(candidates, key=distance)
