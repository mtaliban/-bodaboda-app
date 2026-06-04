import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import aiomqtt

from app.routers.admin import broadcast_event

logger = logging.getLogger(__name__)

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

_task: asyncio.Task | None = None


async def _run():
    while True:
        try:
            async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
                await client.subscribe("rides/#")
                await client.subscribe("drivers/#")
                await client.subscribe("driver/#")
                logger.info("Admin MQTT connected")
                async for message in client.messages:
                    try:
                        data = json.loads(message.payload)
                        broadcast_event({
                            "topic": str(message.topic),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            **data,
                        })
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"Admin MQTT disconnected: {e} — retrying in 5s")
            await asyncio.sleep(5)


def start_subscriber():
    global _task
    loop = asyncio.get_event_loop()
    _task = loop.create_task(_run())


def stop_subscriber():
    if _task:
        _task.cancel()
