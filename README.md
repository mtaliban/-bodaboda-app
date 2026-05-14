# Bodaboda Fullstack CI/CD Assignment

This is a Dockerized Bodaboda fullstack application prepared for a Software Deployment CI/CD assignment. It contains a FastAPI backend, Vite/React frontend, PostgreSQL database, automated tests, and monitoring tools.

---

## Assignment Task 1 Evidence

| Requirement | Status |
|---|---|
| Code pushed to GitHub | ✅ https://github.com/mtaliban/-bodaboda-app |
| `app/` directory exists | ✅ FastAPI backend source code |
| `tests/` directory exists | ✅ pytest test cases |
| `Dockerfile` exists | ✅ Backend Docker image definition |
| At least one test case | ✅ 2 tests passing |
| Docker container runs locally | ✅ `docker compose up --build -d` |
| Monitoring/logs available | ✅ Grafana, Prometheus, Kibana, `docker compose logs` |

---

## Assignment-Required Structure

```
auth_user_service/
├── app/                  ← required
├── tests/                ← required
└── Dockerfile            ← required
```

---

## Full Repository Structure

```
auth_user_service/
├── app/                  # FastAPI backend source code
├── tests/                # pytest test cases
├── frontend/             # Vite/React frontend application
├── Dockerfile            # Backend Docker image definition
├── docker-compose.yml    # Runs backend, frontend, database, and monitoring stack
├── requirements.txt      # Python backend dependencies
├── alembic/              # Database migrations
├── grafana/              # Grafana provisioning/configuration
├── prometheus/           # Prometheus configuration
├── metricbeat.yml        # Metricbeat configuration
├── .gitignore
└── README.md
```

### Folder Descriptions

| Folder/File | Description |
|---|---|
| `app/` | FastAPI backend source code only — routers, models, schemas, services, core config |
| `tests/` | Automated pytest test cases, completely separate from app code |
| `Dockerfile` | Builds the backend Docker image |
| `frontend/` | Vite/React UI — pages, components, API client |
| `docker-compose.yml` | Runs all services together with a single command |

---

## Docker Services

`docker compose up --build -d` starts all of these:

| Service | URL | Description |
|---|---|---|
| Backend (FastAPI) | http://localhost:8001 | Auth/User API |
| Frontend (React) | http://localhost:5173 | Vite/React UI |
| PostgreSQL | localhost:5432 | Main database |
| Grafana | http://localhost:3000 | Metrics dashboards |
| Prometheus | http://localhost:9090 | Metrics scraping |
| Kibana | http://localhost:5601 | Log visualisation |
| Elasticsearch | http://localhost:9200 | Log storage |
| cAdvisor | http://localhost:8080 | Container resource usage |
| Node Exporter | http://localhost:9100 | Host system metrics |
| Metricbeat | — | Collects Docker/host CPU, memory, network metrics |

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
|---|---|
| Frontend | http://localhost:5173 |
| Backend API Docs (Swagger) | http://localhost:8001/docs |
| Backend API Docs (ReDoc) | http://localhost:8001/redoc |
| Health check | http://localhost:8001/health |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Kibana | http://localhost:5601 |

---

## How to Run Tests

```bash
python3 -m pytest tests/ -v
```

Current test cases:

| Test | What it checks |
|---|---|
| `test_health_returns_200` | `GET /health` returns HTTP 200 and `{"status": "ok"}` |
| `test_login_endpoint_exists` | `POST /auth/login` exists and does not return 404 |

Expected output:
```
tests/test_health.py::test_health_returns_200[asyncio] PASSED
tests/test_health.py::test_login_endpoint_exists[asyncio] PASSED
2 passed in ~5s
```

---

## Next CI/CD Steps

- [ ] Create `.github/workflows/ci.yml`
- [ ] Run tests automatically on every push
- [ ] Build Docker image automatically on push
- [ ] Push Docker image to a container registry (Docker Hub / GHCR)
- [ ] Deploy to staging environment automatically
- [ ] Add manual approval gate before production deploy
- [ ] Deploy to production

---

## Backend Stack

- FastAPI + Uvicorn
- PostgreSQL 16
- SQLAlchemy 2.0 (async) + asyncpg
- Alembic migrations
- JWT (access + refresh tokens) via python-jose
- bcrypt password hashing via passlib

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | asyncpg connection string |
| `JWT_SECRET` | Yes | Secret key for signing JWTs |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No (default: 30) | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No (default: 7) | Refresh token lifetime |

---

## Running Database Migrations

**Inside Docker:**
```bash
docker compose exec auth_service alembic upgrade head
```

**Locally:**
```bash
cp .env.example .env   # edit DATABASE_URL to point to local postgres
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

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

Save the tokens:
```bash
TOKEN="<access_token from response>"
REFRESH="<refresh_token from response>"
```

### Get Current User
```bash
curl -s http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Update User Info
```bash
curl -s -X PUT http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Hassan Updated",
    "profile_image_url": "https://example.com/pic.jpg"
  }' | jq
```

### Update Driver Profile
```bash
curl -s -X PUT http://localhost:8001/auth/me/profile \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "license_number": "DRV-999",
    "vehicle_model": "Toyota Noah",
    "plate_number": "T456DEF"
  }' | jq
```

### Refresh Access Token
```bash
curl -s -X POST http://localhost:8001/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH\"}" | jq
```

### Logout
```bash
curl -s -X POST http://localhost:8001/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH\"}" | jq
```

---

## JWT Payload Structure

```json
{
  "sub": "1",
  "role": "RIDER",
  "rider_profile_id": 1,
  "exp": 1234567890
}
```

For drivers, `driver_profile_id` is included instead of `rider_profile_id`.

# CD Pipeline trigger
trigger
retrigger Thu May 14 04:30:02 AM EAT 2026
