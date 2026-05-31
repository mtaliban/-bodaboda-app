"""
Driver Subscriber Simulation — CS 421 BodaBoda MQTT
=====================================================
Simulates a driver app listening for new ride requests.
Run this script to see real-time events from the backend.

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

    elif "ACCEPTED" in et:
        print(f"  ✅  SAFARI IMEKUBALIWA")
        print(f"  trip_id  : {payload.get('trip_id')}")
        print(f"  Status   : {payload.get('status')}")

    elif "COMPLETED" in et:
        print(f"  🏁  SAFARI IMEKAMILIKA")
        print(f"  trip_id  : {payload.get('trip_id')}")

    else:
        print(f"  Payload: {json.dumps(payload, indent=4)}")

    print("═" * 60)


async def run(driver_id: int) -> None:
    print(f"\n🚗  Driver #{driver_id} — BodaBoda Subscriber")
    print(f"    Inaunganisha kwa MQTT broker {MQTT_HOST}:{MQTT_PORT}...")

    async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
        # Subscribe to new rides and all ride status updates
        await client.subscribe("rides/new", qos=1)
        await client.subscribe("rides/+/status", qos=1)
        print(f"    ✅  Imeunganika! Inasubiri safari mpya...\n")

        async for message in client.messages:
            topic = str(message.topic)
            try:
                event = json.loads(message.payload.decode())
                print_event(topic, event)
            except json.JSONDecodeError:
                print(f"  ⚠️  Ujumbe si JSON sahihi: {message.payload}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--driver-id", type=int, default=1)
    args = parser.parse_args()
    asyncio.run(run(args.driver_id))
