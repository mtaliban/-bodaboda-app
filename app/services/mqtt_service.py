import json
import uuid
import logging
from datetime import datetime, timezone

import aiomqtt

MQTT_HOST = "mosquitto"
MQTT_PORT = 1883

logger = logging.getLogger(__name__)


def _make_event(event_type: str, payload: dict) -> str:
    event = {
        "event_id":   str(uuid.uuid4()),
        "event_type": event_type,
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "version":    "1.0",
        "payload":    payload,
    }
    return json.dumps(event)


async def publish(topic: str, event_type: str, payload: dict) -> None:
    message = _make_event(event_type, payload)
    try:
        async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
            await client.publish(topic, payload=message, qos=1)
            logger.info("MQTT published | topic=%s event=%s", topic, event_type)
    except Exception as exc:
        logger.error("MQTT publish failed | topic=%s error=%s", topic, exc)


# ── Topic helpers ─────────────────────────────────────────────────────────────

async def publish_ride_requested(trip: dict) -> None:
    await publish(
        topic="rides/new",
        event_type="RIDE_REQUESTED",
        payload=trip,
    )


async def publish_ride_status(trip_id: int, status: str, extra: dict | None = None) -> None:
    payload = {"trip_id": trip_id, "status": status, **(extra or {})}
    await publish(
        topic=f"rides/{trip_id}/status",
        event_type=f"RIDE_{status}",
        payload=payload,
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
