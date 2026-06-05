import json
import uuid
import logging
from datetime import datetime, timezone

import aiomqtt

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_event(event_type: str, payload: dict) -> str:
    return json.dumps({
        "event_id":   str(uuid.uuid4()),
        "event_type": event_type,
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "version":    "1.0",
        "payload":    payload,
    })


async def publish(topic: str, event_type: str, payload: dict) -> None:
    message = _build_event(event_type, payload)
    try:
        async with aiomqtt.Client(hostname=settings.MQTT_HOST, port=settings.MQTT_PORT) as client:
            await client.publish(topic, payload=message, qos=1)
            logger.info("MQTT published | topic=%s event=%s", topic, event_type)
    except Exception as exc:
        logger.error("MQTT publish failed | topic=%s error=%s", topic, exc)


async def publish_ride_accepted(trip_id: int, driver_id: int, driver_name: str, driver_phone: str, vehicle: str, plate: str, photo_url: str | None = None) -> None:
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type="RIDE_ACCEPTED",
        payload={
            "trip_id":      trip_id,
            "driver_id":    driver_id,
            "status":       "DRIVER_ASSIGNED",
            "driver_name":  driver_name,
            "driver_phone": driver_phone,
            "vehicle":      vehicle,
            "plate":        plate,
            "photo_url":    photo_url or "",
        },
    )


async def publish_driver_approaching(trip_id: int, driver_name: str) -> None:
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type="DRIVER_APPROACHING",
        payload={"trip_id": trip_id, "status": "DRIVER_ASSIGNED", "driver_name": driver_name},
    )


async def publish_driver_arrived(trip_id: int, driver_name: str) -> None:
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type="DRIVER_ARRIVED",
        payload={"trip_id": trip_id, "status": "DRIVER_ARRIVED", "driver_name": driver_name},
    )


async def publish_ride_started(trip_id: int) -> None:
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type="RIDE_STARTED",
        payload={"trip_id": trip_id, "status": "IN_PROGRESS"},
    )


async def publish_ride_completed(trip_id: int) -> None:
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type="RIDE_COMPLETED",
        payload={"trip_id": trip_id, "status": "COMPLETED"},
    )


async def publish_payment_done(trip_id: int, fare: int, rider_cut: int, driver_cut: int, admin_cut: int) -> None:
    for role, amount, msg in [
        ("RIDER",  rider_cut,  f"TSh {rider_cut:,} imekatwa kwa safari #{trip_id}"),
        ("DRIVER", driver_cut, f"TSh {driver_cut:,} imeingizwa mkobani — safari #{trip_id}"),
        ("ADMIN",  admin_cut,  f"TSh {admin_cut:,} mapato ya platform — safari #{trip_id}"),
    ]:
        await publish(
            topic=f"rides/{trip_id}/payment",
            event_type="PAYMENT_DONE",
            payload={
                "trip_id":   trip_id,
                "for_role":  role,
                "amount":    amount,
                "fare":      fare,
                "message":   msg,
            },
        )


async def publish_driver_location(driver_id: int, trip_id: int, lat: float, lng: float) -> None:
    await publish(
        topic=f"driver/{driver_id}/location",
        event_type="DRIVER_LOCATION",
        payload={"driver_id": driver_id, "trip_id": trip_id, "lat": lat, "lng": lng},
    )
