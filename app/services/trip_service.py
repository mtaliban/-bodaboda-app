from datetime import datetime, timezone

from fastapi import HTTPException, status

_SW_DAYS   = ['Jumatatu','Jumanne','Jumatano','Alhamisi','Ijumaa','Jumamosi','Jumapili']
_SW_MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ago','Sep','Okt','Nov','Des']


def _make_trip_name(pickup: str, dest: str, dt: datetime) -> str:
    def shorten(addr: str) -> str:
        for sep in [',', '/', ' - ', '(']:
            if sep in addr:
                addr = addr.split(sep)[0].strip()
                break
        return addr[:22]

    day   = _SW_DAYS[dt.weekday()]
    month = _SW_MONTHS[dt.month - 1]
    return f"{shorten(pickup)} → {shorten(dest)} · {day} {dt.day} {month} {dt.year} {dt.strftime('%H:%M')}"
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.driver import Driver, DriverStatus
from app.models.driver_profile import DriverProfile
from app.models.driver_trip_offer import DriverTripOffer, OfferStatus
from app.models.trip import Trip, TripStatus
from app.models.trip_status_history import TripStatusHistory, ChangedBy
from app.models.user import User, UserRole
import math as _math
from decimal import Decimal

from app.schemas.trip import TripRequest
from app.services.driver_service import DriverService
from app.services.mqtt_service import publish_ride_requested, publish_ride_status
from app.services.notification_service import NotificationService
from app.models.wallet import WalletTransaction


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = _math.radians(lat2 - lat1)
    dlng = _math.radians(lng2 - lng1)
    a = _math.sin(dlat/2)**2 + _math.cos(_math.radians(lat1)) * _math.cos(_math.radians(lat2)) * _math.sin(dlng/2)**2
    return R * 2 * _math.asin(_math.sqrt(a))


def _calc_fare(trip: "Trip") -> int:
    if trip.pickup_lat and trip.pickup_lng and trip.destination_lat and trip.destination_lng:
        km = _haversine_km(trip.pickup_lat, trip.pickup_lng, trip.destination_lat, trip.destination_lng)
        return max(1500, round((1000 + 400 * km) / 10) * 10)
    return 1500

_ACTIVE_STATUSES = {
    TripStatus.SEARCHING_DRIVER,
    TripStatus.DRIVER_ASSIGNED,
    TripStatus.DRIVER_ARRIVED,
    TripStatus.IN_PROGRESS,
}


class TripService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.notif_svc = NotificationService(db)

    def _require_rider(self, user: User) -> int:
        if user.role != UserRole.RIDER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only riders can perform this action",
            )
        if not user.rider_profile:
            raise HTTPException(status_code=400, detail="Rider profile not found")
        return user.rider_profile.id

    async def _check_no_active_trip(self, rider_profile_id: int) -> None:
        result = await self.db.execute(
            select(Trip).where(
                Trip.rider_id == rider_profile_id,
                Trip.status.in_(list(_ACTIVE_STATUSES)),
            ).limit(1)
        )
        trip = result.scalar_one_or_none()
        if not trip:
            return

        # If still searching but all offers expired → auto-expire the trip so rider can retry
        if trip.status == TripStatus.SEARCHING_DRIVER:
            offers_result = await self.db.execute(
                select(DriverTripOffer).where(
                    DriverTripOffer.trip_id == trip.id,
                    DriverTripOffer.status == OfferStatus.OFFERED,
                    DriverTripOffer.expires_at > datetime.now(timezone.utc),
                )
            )
            if not offers_result.scalar_one_or_none():
                trip.status = TripStatus.NO_DRIVER_AVAILABLE
                self.db.add(TripStatusHistory(
                    trip_id=trip.id,
                    status=TripStatus.NO_DRIVER_AVAILABLE.value,
                    changed_by=ChangedBy.SYSTEM,
                ))
                await self.db.commit()
                return

        raise HTTPException(
            status_code=400,
            detail="You already have an active trip",
        )

    async def _get_driver_and_assigned_trip(
        self, user: User, trip_id: int
    ) -> tuple[Driver, Trip]:
        if user.role != UserRole.DRIVER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only drivers can perform this action",
            )

        profile_result = await self.db.execute(
            select(DriverProfile).where(DriverProfile.user_id == user.id)
        )
        auth_profile = profile_result.scalar_one_or_none()
        if not auth_profile:
            raise HTTPException(status_code=404, detail="Driver profile not found")

        driver_result = await self.db.execute(
            select(Driver).where(Driver.driver_profile_id == auth_profile.id)
        )
        driver = driver_result.scalar_one_or_none()
        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver record not found. Call POST /drivers/sync-me first.",
            )

        result = await self.db.execute(
            select(Trip)
            .where(Trip.id == trip_id)
            .options(selectinload(Trip.assigned_driver), selectinload(Trip.status_history))
        )
        trip = result.scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.driver_id != driver.id:
            raise HTTPException(status_code=403, detail="You are not assigned to this trip")

        return driver, trip

    async def request_trip(self, user: User, data: TripRequest) -> Trip:
        rider_profile_id = self._require_rider(user)

        if not data.pickup_address.strip():
            raise HTTPException(status_code=400, detail="pickup_address cannot be empty")
        if not data.destination_address.strip():
            raise HTTPException(status_code=400, detail="destination_address cannot be empty")

        await self._check_no_active_trip(rider_profile_id)

        now = datetime.now(timezone.utc)
        trip = Trip(
            trip_name=_make_trip_name(data.pickup_address.strip(), data.destination_address.strip(), now),
            rider_id=rider_profile_id,
            driver_id=None,
            pickup_address=data.pickup_address.strip(),
            pickup_lat=data.pickup_lat,
            pickup_lng=data.pickup_lng,
            destination_address=data.destination_address.strip(),
            destination_lat=data.destination_lat,
            destination_lng=data.destination_lng,
            ride_type=data.ride_type,
            payment_method=data.payment_method,
            status=TripStatus.SEARCHING_DRIVER,
        )
        self.db.add(trip)
        await self.db.flush()

        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.SEARCHING_DRIVER.value,
            changed_by=ChangedBy.RIDER,
        ))

        driver_svc = DriverService(self.db)
        offer = await driver_svc.match_driver_for_trip(trip)

        if offer is None:
            trip.status = TripStatus.NO_DRIVER_AVAILABLE
            self.db.add(TripStatusHistory(
                trip_id=trip.id,
                status=TripStatus.NO_DRIVER_AVAILABLE.value,
                changed_by=ChangedBy.SYSTEM,
            ))
            await self.notif_svc.create(
                recipient_role="RIDER",
                recipient_profile_id=rider_profile_id,
                title="No driver available",
                message="No driver is available right now. Please try again.",
                type="NO_DRIVER_AVAILABLE",
                related_trip_id=trip.id,
            )

        await self.db.commit()
        await self.db.refresh(trip)

        # Publish MQTT event — drivers receive this instantly
        await publish_ride_requested({
            "trip_id":             trip.id,
            "trip_name":           trip.trip_name,
            "rider_id":            trip.rider_id,
            "pickup_address":      trip.pickup_address,
            "pickup_lat":          trip.pickup_lat,
            "pickup_lng":          trip.pickup_lng,
            "destination_address": trip.destination_address,
            "destination_lat":     trip.destination_lat,
            "destination_lng":     trip.destination_lng,
            "ride_type":           trip.ride_type.value,
            "payment_method":      trip.payment_method.value,
        })

        return trip

    async def get_rider_trips(self, user: User) -> list[Trip]:
        rider_profile_id = self._require_rider(user)

        result = await self.db.execute(
            select(Trip)
            .where(Trip.rider_id == rider_profile_id)
            .options(selectinload(Trip.assigned_driver))
            .order_by(Trip.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_trip_detail(self, user: User, trip_id: int) -> Trip:
        result = await self.db.execute(
            select(Trip)
            .where(Trip.id == trip_id)
            .options(
                selectinload(Trip.assigned_driver),
                selectinload(Trip.status_history),
            )
        )
        trip = result.scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        if user.role == UserRole.RIDER:
            rider_profile_id = self._require_rider(user)
            if trip.rider_id != rider_profile_id:
                raise HTTPException(status_code=403, detail="Not authorized to view this trip")

        elif user.role == UserRole.DRIVER:
            profile_result = await self.db.execute(
                select(DriverProfile).where(DriverProfile.user_id == user.id)
            )
            auth_profile = profile_result.scalar_one_or_none()
            if not auth_profile:
                raise HTTPException(status_code=403, detail="Driver profile not found")

            driver_result = await self.db.execute(
                select(Driver).where(Driver.driver_profile_id == auth_profile.id)
            )
            driver = driver_result.scalar_one_or_none()
            if not driver:
                raise HTTPException(status_code=403, detail="Driver record not found")

            offer_result = await self.db.execute(
                select(DriverTripOffer).where(
                    DriverTripOffer.trip_id == trip_id,
                    DriverTripOffer.driver_id == driver.id,
                )
            )
            offer = offer_result.scalar_one_or_none()
            if not offer and trip.driver_id != driver.id:
                raise HTTPException(status_code=403, detail="Not authorized to view this trip")

        return trip

    async def cancel_trip(self, user: User, trip_id: int) -> Trip:
        rider_profile_id = self._require_rider(user)

        result = await self.db.execute(
            select(Trip)
            .where(Trip.id == trip_id)
            .options(selectinload(Trip.assigned_driver), selectinload(Trip.status_history))
        )
        trip = result.scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.rider_id != rider_profile_id:
            raise HTTPException(status_code=403, detail="Not authorized to cancel this trip")

        cancellable = {TripStatus.SEARCHING_DRIVER, TripStatus.NO_DRIVER_AVAILABLE}
        if trip.status not in cancellable:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel a trip with status {trip.status.value}",
            )

        trip.status = TripStatus.CANCELLED
        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.CANCELLED.value,
            changed_by=ChangedBy.RIDER,
        ))
        await self.notif_svc.create(
            recipient_role="RIDER",
            recipient_profile_id=rider_profile_id,
            title="Trip cancelled",
            message="Your trip has been cancelled.",
            type="TRIP_CANCELLED",
            related_trip_id=trip.id,
        )

        await self.db.commit()
        await self.db.refresh(trip)
        return trip

    async def driver_arrived(self, user: User, trip_id: int) -> Trip:
        driver, trip = await self._get_driver_and_assigned_trip(user, trip_id)

        if trip.status != TripStatus.DRIVER_ASSIGNED:
            raise HTTPException(
                status_code=400,
                detail=f"Trip status must be DRIVER_ASSIGNED, got {trip.status.value}",
            )

        trip.status = TripStatus.DRIVER_ARRIVED
        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.DRIVER_ARRIVED.value,
            changed_by=ChangedBy.DRIVER,
        ))
        await self.notif_svc.create(
            recipient_role="RIDER",
            recipient_profile_id=trip.rider_id,
            title="Driver arrived",
            message="Your driver has arrived at the pickup location.",
            type="DRIVER_ARRIVED",
            related_trip_id=trip.id,
        )

        await self.db.commit()
        await self.db.refresh(trip)
        return trip

    async def start_trip(self, user: User, trip_id: int) -> Trip:
        driver, trip = await self._get_driver_and_assigned_trip(user, trip_id)

        allowed = {TripStatus.DRIVER_ARRIVED, TripStatus.DRIVER_ASSIGNED}
        if trip.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Trip must be DRIVER_ARRIVED or DRIVER_ASSIGNED to start, got {trip.status.value}",
            )

        trip.status = TripStatus.IN_PROGRESS
        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.IN_PROGRESS.value,
            changed_by=ChangedBy.DRIVER,
        ))
        await self.notif_svc.create(
            recipient_role="RIDER",
            recipient_profile_id=trip.rider_id,
            title="Trip started",
            message="Your trip has started.",
            type="TRIP_STARTED",
            related_trip_id=trip.id,
        )

        await self.db.commit()
        await self.db.refresh(trip)
        return trip

    async def complete_trip(self, user: User, trip_id: int) -> Trip:
        driver, trip = await self._get_driver_and_assigned_trip(user, trip_id)

        if trip.status != TripStatus.IN_PROGRESS:
            raise HTTPException(
                status_code=400,
                detail=f"Trip must be IN_PROGRESS to complete, got {trip.status.value}",
            )

        trip.status = TripStatus.COMPLETED
        driver.status = DriverStatus.AVAILABLE
        driver.current_trip_id = None

        self.db.add(TripStatusHistory(
            trip_id=trip.id,
            status=TripStatus.COMPLETED.value,
            changed_by=ChangedBy.DRIVER,
        ))

        # Auto-deduct fare from rider's wallet
        from sqlalchemy import update
        from app.models.rider_profile import RiderProfile
        fare = _calc_fare(trip)
        rp_result = await self.db.execute(
            select(RiderProfile).where(RiderProfile.id == trip.rider_id)
        )
        rp = rp_result.scalar_one_or_none()
        rider_user_result = await self.db.execute(
            select(User).where(User.id == rp.user_id)
        ) if rp else None
        rider_user = rider_user_result.scalar_one_or_none() if rider_user_result else None
        if rider_user is not None:
            old_bal = Decimal(str(getattr(rider_user, 'wallet_balance', 0) or 0))
            new_bal = max(Decimal('0'), old_bal - Decimal(str(fare)))
            await self.db.execute(
                update(User).where(User.id == rider_user.id).values(wallet_balance=new_bal)
            )
            self.db.add(WalletTransaction(
                user_id=rider_user.id,
                type="DEBIT",
                amount=Decimal(str(fare)),
                balance_after=new_bal,
                trip_id=trip.id,
                description=f"Safari #{trip.id} — {trip.pickup_address or ''} → {trip.destination_address or ''}",
            ))
            wallet_msg = f"TSh {fare:,} imekatwa kwa safari yako."
        else:
            wallet_msg = "Safari imekamilika."

        await self.notif_svc.create(
            recipient_role="RIDER",
            recipient_profile_id=trip.rider_id,
            title="Safari imekamilika",
            message=wallet_msg,
            type="TRIP_COMPLETED",
            related_trip_id=trip.id,
        )

        await self.db.commit()
        await self.db.refresh(trip)
        return trip
