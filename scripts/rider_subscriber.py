"""
Rider Subscriber Simulation — CS 421 BodaBoda MQTT
====================================================
Simulates a rider app listening for ride status updates,
driver GPS movements, and chat messages from the driver.

Usage:
  python scripts/rider_subscriber.py
  python scripts/rider_subscriber.py --trip-id 29 --driver-id 1
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

    if et == "RIDE_ACCEPTED":
        print(f"  ✅  DEREVA AMEKUBALI SAFARI YAKO!")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  Dereva     : {payload.get('driver_name')}")
        print(f"  Gari       : {payload.get('vehicle')} ({payload.get('plate')})")
        print(f"  Status     : {payload.get('status')}")
        print_gps(payload)
        print()
        print(f"  💡  Dereva yuko njiani kuja kukuchukua.")

    elif et == "RIDE_STARTED":
        print(f"  🚀  SAFARI YAKO IMEANZA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  Status     : {payload.get('status')}")
        print_gps(payload)
        print()
        print(f"  💡  Una furahia safari yako!")

    elif et == "RIDE_COMPLETED":
        print(f"  🏁  SAFARI YAKO IMEKAMILIKA")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print(f"  Status     : {payload.get('status')}")
        print(f"  Fare       : {payload.get('fare_tzs')} TZS")
        print_gps(payload)
        print()
        print(f"  💡  Asante kwa kutumia BodaBoda!")

    elif et == "DRIVER_APPROACHING":
        print(f"  📡  DEREVA ANAKARIBIA KUKUCHUKUA")
        print(f"  Dereva     : {payload.get('driver_name')}")
        print_gps(payload)

    elif et == "DRIVER_ARRIVED":
        print(f"  📍  DEREVA AMEFIKA — Karibu kwenye gari!")
        print(f"  trip_id    : {payload.get('trip_id')}")
        print_gps(payload)

    elif et == "DRIVER_LOCATION":
        lat = payload.get('lat')
        lng = payload.get('lng')
        driver_id = payload.get('driver_id')
        action = payload.get('action', '')
        print(f"  📍  DEREVA YUKO HAPA SASA")
        print(f"  driver_id  : {driver_id}")
        if action:
            print(f"  Hali       : {action}")
        print(f"  Latitude   : {lat}")
        print(f"  Longitude  : {lng}")
        if lat is not None and lng is not None:
            print(f"  🗺️  Maps    : https://maps.google.com/?q={lat},{lng}")

    elif et == "RIDE_CHAT":
        print(f"  💬  UJUMBE KUTOKA KWA DEREVA")
        print(f"  Jina       : {payload.get('sender_name')}")
        print(f"  Ujumbe     : {payload.get('message')}")

    else:
        print(f"  Payload: {json.dumps(payload, indent=4)}")

    print("═" * 60)


async def run(trip_id: int, driver_id: int) -> None:
    print(f"\n🧍  Rider — BodaBoda MQTT Subscriber")
    print(f"    Inaunganisha kwa MQTT broker {MQTT_HOST}:{MQTT_PORT}...")

    async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
        # Ride status updates (accepted, started, completed)
        await client.subscribe(f"rides/{trip_id}/status", qos=1)
        await client.subscribe("rides/+/status", qos=1)
        # Driver location (rider anaona dereva akisonga)
        await client.subscribe(f"driver/{driver_id}/location", qos=1)
        await client.subscribe("driver/+/location", qos=1)
        # Chat messages
        await client.subscribe(f"rides/{trip_id}/chat", qos=1)
        await client.subscribe("rides/+/chat", qos=1)

        print(f"    ✅  Imeunganika! Inasikiliza topics za RIDER:")
        print(f"        • rides/{trip_id}/status       (Status: ASSIGNED, STARTED, COMPLETED)")
        print(f"        • rides/+/status              (Status ya safari zote)")
        print(f"        • driver/{driver_id}/location  (GPS ya dereva)")
        print(f"        • driver/+/location           (GPS ya drivers wote)")
        print(f"        • rides/{trip_id}/chat         (Chat na dereva)")
        print(f"\n    Inasubiri ujumbe...\n")

        async for message in client.messages:
            topic = str(message.topic)
            try:
                event = json.loads(message.payload.decode())
                print_event(topic, event)
            except json.JSONDecodeError:
                print(f"  ⚠️  Ujumbe si JSON sahihi: {message.payload}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BodaBoda Rider MQTT Subscriber Simulation")
    parser.add_argument("--trip-id", type=int, default=29, help="Trip ID (default: 29)")
    parser.add_argument("--driver-id", type=int, default=1, help="Driver ID (default: 1)")
    args = parser.parse_args()
    asyncio.run(run(args.trip_id, args.driver_id))
