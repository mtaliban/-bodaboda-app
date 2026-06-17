import { useEffect, useRef, useCallback } from 'react';
import mqtt, { MqttClient } from 'mqtt';

// HiveMQ Cloud — hosted MQTT broker (Assignment 3 third-party integration)
const HIVEMQ_WS_URL  = 'wss://my-bodaboda-cce7baf3.a03.euc1.aws.hivemq.cloud:8884/mqtt';
const HIVEMQ_USER    = 'mtalibani';
const HIVEMQ_PASS    = 'Mimi$100';

const MQTT_WS_URL = HIVEMQ_WS_URL;

export interface MqttEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  version: string;
  payload: Record<string, unknown>;
}

type Handler = (event: MqttEvent) => void;

export function useMqtt(topics: string[], onMessage: Handler) {
  const clientRef = useRef<MqttClient | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    const client = mqtt.connect(MQTT_WS_URL, {
      username: HIVEMQ_USER,
      password: HIVEMQ_PASS,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    });
    clientRef.current = client;

    client.on('connect', () => {
      topics.forEach(t => client.subscribe(t, { qos: 1 }));
    });

    client.on('message', (_topic, message) => {
      try {
        const event: MqttEvent = JSON.parse(message.toString());
        onMessageRef.current(event);
      } catch {
        // ignore malformed
      }
    });

    return () => {
      client.end(true);
      clientRef.current = null;
    };
  }, [topics.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = useCallback((topic: string, payload: object) => {
    clientRef.current?.publish(topic, JSON.stringify(payload));
  }, []);

  return { publish };
}
