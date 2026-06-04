"""
Driver Subscriber Simulation — CS 421 BodaBoda MQTT
=====================================================
Simulates a driver app listening for new ride requests,
ride status changes, and real-time GPS location updates.

Usage:
  python scripts/driver_subscriber.py
  python scripts/driver_subscriber.py --driver-id 5
"""
import asyncio
import json
import argparse
from datetime import datetime

import aiomqtt

MQTT_HOST = "localhost"
MQTT_PORT = 1883


def print_gps(payload: dict) -> None:
    lat = payload.get('lat')
    lng = payload.get('lng')
    if lat is not None and lng is not None:
        print(f"  📍 GPS        : {lat}, {lng}")
        print(f"  🗺️  Maps link  : https://maps.google.com/?q={lat},{lng}")


def print_event(topic: str, event: dict) -> None:
    print("\n" + "═" * 60)
    print(f"  📨  EVENT RECEIVED — {datetime.now().strftime('%H:%M:%S')}")
    print("═" * 60)
    print(f"  Topic      : {topic}")
    print(f"  event_id   : {event.get('event_id')}")
    print(f"  event_type : {event.get('event_type')}")
    print(f"  timestamp  : {event.get('timestamp')}")
    print(f"  version    : {event.get('version')}")
    print()

    payload = event.get("payload", {})
    et = event.get("event_type", "")

    if et == "RIDE_REQUESTED":
        print(f"  🏍️  SAFARI MPYA!")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  Kutoka     : {payload.get('pickup_address')}")
        print(f"  Pickup GPS : {payload.get('pickup_lat')}, {payload.get('pickup_lng')}")
        print(f"  Kwenda     : {payload.get('destination_address')}")
        print(f"  Dest GPS   : {payload.get('destination_lat')}, {payload.get('destination_lng')}")
        print(f"  Aina       : {payload.get('ride_type')}")
        print(f"  Malipo     : {payload.get('payment_method')}")
        print()
        print(f"  👉  Kubali: POST http://localhost:8001/trips/{payload.get('trip_id')}/accept")

    elif et == "RIDE_ACCEPTED":
        print(f"  ✅  SAFARI IMEKUBALIWA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  driver_id  : {payload.get('driver_id')}")
        print(f"  Dereva     : {payload.get('driver_name')}")
        print(f"  Gari       : {payload.get('vehicle')} ({payload.get('plate')})")
        print(f"  Status     : {payload.get('status')}")
        print_gps(payload)

    elif et == "RIDE_STARTED":
        print(f"  🚀  SAFARI IMEANZA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  driver_id  : {payload.get('driver_id')}")
        print(f"  Status     : {payload.get('status')}")
        print_gps(payload)

    elif et == "RIDE_COMPLETED":
        print(f"  🏁  SAFARI IMEKAMILIKA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  driver_id  : {payload.get('driver_id')}")
        print(f"  Status     : {payload.get('status')}")
        print_gps(payload)

    elif et == "DRIVER_APPROACHING":
        print(f"  📡  DEREVA ANAKARIBIA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  Dereva     : {payload.get('driver_name')}")
        print_gps(payload)

    elif et == "DRIVER_ARRIVED":
        print(f"  📍  DEREVA AMEFIKA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print_gps(payload)

    elif et == "DRIVER_LOCATION":
        lat = payload.get('lat')
        lng = payload.get('lng')
        driver_id = payload.get('driver_id')
        trip_id   = payload.get('trip_id')
        action    = payload.get('action', '')
        print(f"  📍  DRIVER GPS UPDATE")
        print(f"  driver_id  : {driver_id}")
        print(f"  trip_id    : {trip_id}")
        if action:
            print(f"  action     : {action}")
        print(f"  Latitude   : {lat}")
        print(f"  Longitude  : {lng}")
        if lat is not None and lng is not None:
            print(f"  Maps link  : https://maps.google.com/?q={lat},{lng}")

    elif et == "RIDE_AVAILABLE":
        print(f"  📢  SAFARI INAPATIKANA (broadcast kwa drivers)")
        print(f"  trip_id          : {payload.get('trip_id')}")
        print(f"  Kutoka           : {payload.get('pickup_address')}")
        print(f"  Kwenda           : {payload.get('destination_address')}")
        print(f"  Drivers wanaopatikana: {payload.get('available_driver_count')}")

    else:
        print(f"  Payload: {json.dumps(payload, indent=4)}")

    print("═" * 60)


async def run(driver_id: int) -> None:
    print(f"\n🚗  Driver #{driver_id} — BodaBoda MQTT Subscriber")
    print(f"    Inaunganisha kwa MQTT broker {MQTT_HOST}:{MQTT_PORT}...")

    async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
        # Option A: Ride requests
        await client.subscribe("rides/new", qos=1)
        # Option C: Ride status updates (accepted, started, completed)
        await client.subscribe("rides/+/status", qos=1)
        # Option B: Driver GPS location updates
        await client.subscribe(f"driver/{driver_id}/location", qos=1)
        await client.subscribe("driver/+/location", qos=1)
        # Broadcast to available drivers
        await client.subscribe("drivers/available/rides", qos=1)

        print(f"    ✅  Imeunganika! Inasikiliza topics:")
        print(f"        • rides/new                  (Option A — safari mpya)")
        print(f"        • rides/+/status             (Option C — status updates)")
        print(f"        • driver/{driver_id}/location        (Option B — GPS yangu)")
        print(f"        • driver/+/location          (Option B — GPS drivers wote)")
        print(f"        • drivers/available/rides    (broadcast kwa drivers)")
        print(f"\n    Inasubiri ujumbe...\n")

        async for message in client.messages:
            topic = str(message.topic)
            try:
                event = json.loads(message.payload.decode())
                print_event(topic, event)
            except json.JSONDecodeError:
                print(f"  ⚠️  Ujumbe si JSON sahihi: {message.payload}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BodaBoda MQTT Subscriber Simulation")
    parser.add_argument("--driver-id", type=int, default=1, help="Driver ID (default: 1)")
    args = parser.parse_args()
    asyncio.run(run(args.driver_id))
