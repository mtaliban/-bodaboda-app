# Auth/User Service

Shared authentication service for the Rider App and Driver App in the BodaBoda ride-hailing backend.

## Stack
- FastAPI + Uvicorn
- PostgreSQL 16
- SQLAlchemy 2.0 (async) + asyncpg
- Alembic migrations
- JWT (access + refresh) via python-jose
- bcrypt password hashing via passlib

---

## Running with Docker (recommended)

```bash
cd auth_user_service
docker compose up --build
```

Service is available at **http://localhost:8001**  
Postgres is available at **localhost:5432**

---

## Running migrations

**Inside Docker (after `docker compose up`):**
```bash
docker compose exec auth_service alembic revision --autogenerate -m "initial"
docker compose exec auth_service alembic upgrade head
```

**Locally (with a local Postgres):**
```bash
cp .env.example .env          # edit DATABASE_URL to point to local postgres
pip install -r requirements.txt
alembic revision --autogenerate -m "initial"
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

---

## API Docs

After starting the service, interactive docs are at:  
- Swagger UI: http://localhost:8001/docs  
- ReDoc: http://localhost:8001/redoc

---

## Sample curl requests

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

Save the tokens from the response:
```bash
TOKEN="<access_token from response>"
REFRESH="<refresh_token from response>"
```

### Get current user (/me)
```bash
curl -s http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Update user info
```bash
curl -s -X PUT http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Hassan Updated",
    "profile_image_url": "https://example.com/pic.jpg"
  }' | jq
```

### Update driver profile
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

### Refresh access token
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

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | required | asyncpg connection string |
| `JWT_SECRET` | required | Secret key for signing JWTs |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime |

---

## JWT payload structure

```json
{
  "sub": "1",
  "role": "RIDER",
  "rider_profile_id": 1,
  "exp": 1234567890
}
```

For drivers, `driver_profile_id` is included instead of `rider_profile_id`.
