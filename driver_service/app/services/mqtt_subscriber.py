"""
MQTT Subscriber — Driver Service
Listens to rides/new from Rider Service and broadcasts to available drivers.
Runs as a background asyncio task when the app starts.
"""
import asyncio
import json
import logging
import ssl

import aiomqtt
from sqlalchemy import select

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.driver import Driver, DriverStatus
from app.services.mqtt_publisher import publish

logger = logging.getLogger(__name__)


def _mqtt_client_kwargs() -> dict:
    kwargs: dict = {
        "hostname": settings.MQTT_HOST,
        "port":     settings.MQTT_PORT,
    }
    if settings.MQTT_USER:
        kwargs["username"] = settings.MQTT_USER
    if settings.MQTT_PASSWORD:
        kwargs["password"] = settings.MQTT_PASSWORD
    if settings.MQTT_PORT == 8883:
        kwargs["tls_context"] = ssl.create_default_context()
    return kwargs

_subscriber_task: asyncio.Task | None = None


async def _handle_ride_requested(payload: dict) -> None:
    """Find available drivers and broadcast the ride request to them."""
    trip_id = payload.get("trip_id")
    logger.info("New ride request received | trip_id=%s", trip_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Driver).where(Driver.status == DriverStatus.AVAILABLE)
        )
        available_drivers = result.scalars().all()

    count = len(available_drivers)
    logger.info("Available drivers found: %d", count)

    if count == 0:
        logger.warning("No available drivers for trip_id=%s", trip_id)
        return

    # Broadcast to all available drivers via a dedicated topic
    await publish(
        topic="drivers/available/rides",
        event_type="RIDE_AVAILABLE",
        payload={**payload, "available_driver_count": count},
    )
    logger.info("Broadcasted ride to %d drivers | trip_id=%s", count, trip_id)


async def _subscriber_loop() -> None:
    """Main subscriber loop — reconnects automatically on failure."""
    while True:
        try:
            logger.info("MQTT Subscriber connecting to %s:%d", settings.MQTT_HOST, settings.MQTT_PORT)
            async with aiomqtt.Client(**_mqtt_client_kwargs()) as client:
                await client.subscribe("rides/new", qos=1)
                logger.info("MQTT Subscriber ready | listening on rides/new")

                async for message in client.messages:
                    topic = str(message.topic)
                    try:
                        event = json.loads(message.payload.decode())
                        event_type = event.get("event_type")
                        payload = event.get("payload", {})

                        logger.info("MQTT received | topic=%s event=%s", topic, event_type)

                        if event_type == "RIDE_REQUESTED":
                            await _handle_ride_requested(payload)

                    except json.JSONDecodeError:
                        logger.error("Invalid JSON on topic=%s", topic)
                    except Exception as exc:
                        logger.error("Error handling MQTT message: %s", exc)

        except aiomqtt.MqttError as exc:
            logger.warning("MQTT disconnected: %s — reconnecting in 5s", exc)
            await asyncio.sleep(5)
        except Exception as exc:
            logger.error("MQTT subscriber error: %s — reconnecting in 5s", exc)
            await asyncio.sleep(5)


def start_subscriber() -> None:
    global _subscriber_task
    _subscriber_task = asyncio.create_task(_subscriber_loop())
    logger.info("MQTT subscriber task started")


def stop_subscriber() -> None:
    global _subscriber_task
    if _subscriber_task:
        _subscriber_task.cancel()
        logger.info("MQTT subscriber task stopped")
