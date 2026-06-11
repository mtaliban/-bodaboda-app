"""
Rider/Backend Publisher Simulation — CS 421 BodaBoda MQTT
=========================================================
Simulates a rider requesting a ride and the backend publishing
events to MQTT. Pair with driver_subscriber.py to demonstrate
publish + subscribe in real time.

Usage:
  python scripts/rider_publisher.py                # demo nzima ya safari
  python scripts/rider_publisher.py --event ride   # tuma RIDE_REQUESTED tu
  python scripts/rider_publisher.py --event gps    # tuma DRIVER_LOCATION tu
  python scripts/rider_publisher.py --event status # tuma RIDE_STARTED tu
"""
import asyncio
import json
import argparse
from datetime import datetime, timezone

import aiomqtt

MQTT_HOST = "localhost"
MQTT_PORT = 1883


def make_event(event_type: str, payload: dict) -> str:
    return json.dumps({
        "event_id": f"{event_type.lower()}_{int(datetime.now().timestamp() * 1000)}",
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0",
        "payload": payload,
    })


async def publish_one(client: aiomqtt.Client, topic: str, event_type: str, payload: dict) -> None:
    message = make_event(event_type, payload)
    await client.publish(topic, payload=message, qos=1)
    print(f"  ✅  Tumetuma  {event_type:20s}  →  {topic}")


async def demo_ride_requested(client: aiomqtt.Client) -> None:
    await publish_one(client, "rides/new", "RIDE_REQUESTED", {
        "trip_id": 99,
        "rider_id": 7,
        "pickup_address": "UDOM Main Gate",
        "pickup_lat": -6.1711,
        "pickup_lng": 35.7402,
        "destination_address": "Dodoma Town Centre",
        "destination_lat": -6.1730,
        "destination_lng": 35.7390,
        "ride_type": "BODA",
        "payment_method": "CASH",
        "fare_tzs": 2500,
    })


async def demo_ride_available(client: aiomqtt.Client) -> None:
    await publish_one(client, "drivers/available/rides", "RIDE_AVAILABLE", {
        "trip_id": 99,
        "pickup_address": "UDOM Main Gate",
        "destination_address": "Dodoma Town Centre",
        "available_driver_count": 3,
    })


async def demo_ride_accepted(client: aiomqtt.Client) -> None:
    await publish_one(client, "rides/99/status", "RIDE_ACCEPTED", {
        "trip_id": 99,
        "driver_id": 1,
        "driver_name": "Juma Ally",
        "vehicle": "Toyota IST",
        "plate": "T123ABC",
        "status": "DRIVER_ASSIGNED",
        "lat": -6.1715,
        "lng": 35.7405,
    })


async def demo_driver_location(client: aiomqtt.Client) -> None:
    points = [
        (-6.1715, 35.7405, "Approaching pickup"),
        (-6.1713, 35.7403, "Closer to pickup"),
        (-6.1711, 35.7402, "At pickup point"),
        (-6.1720, 35.7398, "Heading to destination"),
        (-6.1730, 35.7390, "At destination"),
    ]
    for lat, lng, note in points:
        await publish_one(client, "driver/1/location", "DRIVER_LOCATION", {
            "driver_id": 1,
            "trip_id": 99,
            "lat": lat,
            "lng": lng,
            "action": note,
        })
        await asyncio.sleep(1)


async def demo_ride_started(client: aiomqtt.Client) -> None:
    await publish_one(client, "rides/99/status", "RIDE_STARTED", {
        "trip_id": 99,
        "driver_id": 1,
        "status": "IN_PROGRESS",
        "lat": -6.1711,
        "lng": 35.7402,
    })


async def demo_ride_completed(client: aiomqtt.Client) -> None:
    await publish_one(client, "rides/99/status", "RIDE_COMPLETED", {
        "trip_id": 99,
        "driver_id": 1,
        "status": "COMPLETED",
        "lat": -6.1730,
        "lng": 35.7390,
        "fare_tzs": 2500,
    })


async def run(event: str) -> None:
    print(f"\n📡  BodaBoda MQTT Publisher")
    print(f"    Inaunganisha kwa MQTT broker {MQTT_HOST}:{MQTT_PORT}...")

    async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
        print(f"    ✅  Imeunganika!\n")

        if event == "ride":
            await demo_ride_requested(client)
        elif event == "gps":
            await demo_driver_location(client)
        elif event == "status":
            await demo_ride_started(client)
        elif event == "full":
            print("  🎬  DEMO KAMILI YA SAFARI\n")
            await demo_ride_requested(client)
            await asyncio.sleep(1)
            await demo_ride_available(client)
            await asyncio.sleep(1)
            await demo_ride_accepted(client)
            await asyncio.sleep(1)
            print("\n  📍  Inatuma GPS updates (driver anaelekea kwa rider)...\n")
            await demo_driver_location(client)
            await asyncio.sleep(1)
            await demo_ride_started(client)
            await asyncio.sleep(2)
            await demo_ride_completed(client)

        print(f"\n  🏁  Imekamilika. Angalia terminal ya subscriber.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BodaBoda MQTT Publisher Simulation")
    parser.add_argument(
        "--event",
        choices=["ride", "gps", "status", "full"],
        default="full",
        help="Aina ya event ya kutuma (default: full demo)",
    )
    args = parser.parse_args()
    asyncio.run(run(args.event))
