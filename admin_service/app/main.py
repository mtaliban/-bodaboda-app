import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.admin import router as admin_router
from app.services.mqtt_subscriber import start_subscriber, stop_subscriber

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_subscriber()
    yield
    stop_subscriber()


app = FastAPI(
    title="BodaBoda Admin Service",
    description="Admin dashboard API — manage users, trips, drivers",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_router, prefix="/admin", tags=["Admin"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "admin_service"}
