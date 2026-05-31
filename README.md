# Bodaboda Fullstack CI/CD + MQTT Assignment

This is a Dockerized Bodaboda fullstack application prepared for a Software Deployment CI/CD and MQTT Real-Time Communication assignment. It contains two FastAPI backends, a Vite/React frontend, PostgreSQL database, MQTT broker (Mosquitto), automated tests, and monitoring tools.

---

## Assignment Task 1 — CI/CD Evidence

| Requirement | Status |
|-------------|--------|
| Code pushed to GitHub | ✅ https://github.com/mtaliban/-bodaboda-app |
| `app/` directory exists | ✅ FastAPI backend source code |
| `tests/` directory exists | ✅ pytest test cases |
| `Dockerfile` exists | ✅ Backend Docker image definition |
| At least one test case | ✅ 2 tests passing |
| Docker container runs locally | ✅ `docker compose up --build -d` |
| Monitoring/logs available | ✅ Grafana, Prometheus, Kibana, `docker compose logs` |

---

## Assignment Task 2 — MQTT Integration Evidence

| Requirement | Status |
|-------------|--------|
| MQTT broker running in Docker | ✅ Eclipse Mosquitto 2.0 (ports 1883, 9001) |
| Option B: Driver Location Updates | ✅ Driver publishes GPS → Rider sees live on map |
| Option A: Ride Request Broadcasting | ✅ Backend publishes → Driver receives via `driver/{id}/offers` |
| Option C: Ride Status Updates | ✅ Status events via `rides/{id}/events` |
| Chat over MQTT | ✅ Rider ↔ Driver real-time chat via `rides/{id}/chat` |
| MQTT test in CI pipeline | ✅ Mosquitto starts + publish/receive test on every push |
| MQTT in CD pipeline | ✅ Mosquitto deployed with full stack on EC2 |
| Client simulation script | ✅ `scripts/driver_subscriber.py` |

---

## MQTT Integration

### Feature Implemented
All three options implemented:
- **Option A** — Ride Request Broadcasting
- **Option B** — Driver Location Updates (real GPS via browser geolocation)
- **Option C** — Ride Status Updates

### Topics Used

| Topic | Publisher | Subscriber | Description |
|-------|-----------|------------|-------------|
| `driver/{id}/location` | Driver app | Rider app | Real-time GPS — rider sees boda moving on map |
| `rides/{id}/chat` | Rider / Driver | Both | Real-time chat between rider and driver |
| `rides/{id}/events` | Backend | Rider app | Trip status changes (ASSIGNED, IN_PROGRESS, etc.) |
| `driver/{id}/offers` | Backend | Driver app | New ride requests sent to available drivers |

### Message Format (JSON)

```json
{
  "event_id": "loc_1717123456789",
  "event_type": "DRIVER_LOCATION",
  "timestamp": "2026-05-31T10:00:00Z",
  "version": "1.0",
  "payload": {
    "lat": -6.1711,
    "lng": 35.7402
  }
}
```

### How It Works

1. **Driver** opens the app → browser requests GPS permission
2. Every time driver moves more than 8 metres, location is published to `driver/{id}/location`
3. **Rider** is subscribed to that topic → the boda 🏍️ marker moves on the map in real time
4. If no real GPS arrives, map shows a simulation (marked as "● simulation")
5. As soon as real GPS arrives, simulation stops automatically

### Simulation Script

```bash
python scripts/driver_subscriber.py --driver-id 1
```

---

## Full Repository Structure

```
auth_user_service/
├── app/                      # Auth/User FastAPI backend (port 8001)
├── driver_service/           # Driver FastAPI backend (port 8002)
│   ├── app/
│   │   ├── routers/
│   │   ├── models/
│   │   ├── schemas/
│   │   └── services/
│   │       ├── mqtt_publisher.py
│   │       └── mqtt_subscriber.py
│   ├── Dockerfile
│   └── requirements.txt
├── tests/                    # pytest test cases
├── frontend/                 # Vite/React frontend (port 5173)
├── mosquitto/
│   └── config/
│       └── mosquitto.conf    # MQTT broker config (TCP 1883 + WS 9001)
├── scripts/
│   └── driver_subscriber.py  # MQTT simulation/demo script
├── Dockerfile                # Auth backend Docker image
├── docker-compose.yml        # Runs all services with one command
├── requirements.txt          # Python backend dependencies
├── alembic/                  # Database migrations
├── grafana/                  # Grafana provisioning
├── prometheus/               # Prometheus configuration
├── metricbeat.yml            # Metricbeat configuration
├── .github/workflows/
│   ├── ci.yml                # CI: tests + MQTT test + Docker build
│   └── cd.yml                # CD: deploy full stack to EC2
└── README.md
```

---

## Docker Services

`docker compose up --build -d` starts all of these:

| Service | URL | Description |
|---------|-----|-------------|
| Auth Backend (FastAPI) | http://localhost:8001 | Auth/User API |
| Driver Backend (FastAPI) | http://localhost:8002 | Driver/Trip/Offer API |
| Frontend (React) | http://localhost:5173 | Vite/React UI |
| Mosquitto (MQTT) | localhost:1883 / ws:9001 | MQTT broker |
| PostgreSQL | localhost:5432 | Main database |
| Grafana | http://localhost:3000 | Metrics dashboards |
| Prometheus | http://localhost:9090 | Metrics scraping |
| Kibana | http://localhost:5601 | Log visualisation |
| Elasticsearch | http://localhost:9200 | Log storage |
| cAdvisor | http://localhost:8080 | Container resource usage |
| Node Exporter | http://localhost:9100 | Host system metrics |

---

## CI/CD Pipeline

### CI (`ci.yml`) — runs on every push to `main`

1. Start PostgreSQL service
2. Start Mosquitto MQTT broker (using repo mosquitto config)
3. Install Python dependencies
4. Run backend tests (`pytest`)
5. **MQTT test** — publish a message to `rides/test/events` → verify it is received
6. Build all Docker images (`docker compose build`)

### CD (`cd.yml`) — runs automatically after CI passes

1. SSH into EC2 production server
2. `git pull` latest code
3. `docker compose down` old containers
4. `docker compose build` with EC2 public IP set for frontend
5. `docker compose up -d` — starts ALL services including MQTT broker
6. Verify MQTT broker is responding

---

## How to Run Locally

```bash
cd ~/Desktop/BODABODA/auth_user_service
docker compose down
docker compose up --build -d
docker compose ps
```

> Note: Elasticsearch takes ~60 seconds to become healthy. Kibana and Metricbeat start after it.

---

## How to Access the App

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Auth API Docs (Swagger) | http://localhost:8001/docs |
| Driver API Docs (Swagger) | http://localhost:8002/docs |
| Health check | http://localhost:8001/health |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Kibana | http://localhost:5601 |

---

## How to Run Tests

```bash
python3 -m pytest tests/ -v
```

| Test | What it checks |
|------|----------------|
| `test_health_returns_200` | `GET /health` returns HTTP 200 and `{"status": "ok"}` |
| `test_login_endpoint_exists` | `POST /auth/login` exists and does not return 404 |

Expected output:
```
tests/test_health.py::test_health_returns_200[asyncio] PASSED
tests/test_health.py::test_login_endpoint_exists[asyncio] PASSED
2 passed in ~5s
```

---

## Backend Stack

- FastAPI + Uvicorn
- PostgreSQL 16
- SQLAlchemy 2.0 (async) + asyncpg
- Alembic migrations
- JWT (access + refresh tokens) via python-jose
- bcrypt password hashing via passlib
- aiomqtt for MQTT publish/subscribe

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | asyncpg connection string |
| `JWT_SECRET` | Yes | Secret key for signing JWTs |
| `MQTT_HOST` | No (default: mosquitto) | MQTT broker hostname |
| `MQTT_PORT` | No (default: 1883) | MQTT broker port |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No (default: 30) | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No (default: 7) | Refresh token lifetime |

---

## API Examples

### Register a Rider
```bash
curl -s -X POST http://localhost:8001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Hassan Hussein",
    "phone": "+255712345678",
    "email": "hassan@gmail.com",
    "password": "123456",
    "role": "RIDER"
  }' | jq
```

### Register a Driver
```bash
curl -s -X POST http://localhost:8001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Juma Ally",
    "phone": "+255755111222",
    "email": "juma@gmail.com",
    "password": "123456",
    "role": "DRIVER",
    "driver_profile": {
      "license_number": "DRV-123",
      "vehicle_model": "Toyota IST",
      "plate_number": "T123ABC"
    }
  }' | jq
```

### Login
```bash
curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email_or_phone": "hassan@gmail.com",
    "password": "123456"
  }' | jq
```
