import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.driver import router as driver_router
from app.services.mqtt_subscriber import start_subscriber, stop_subscriber

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start MQTT subscriber background task on startup
    start_subscriber()
    yield
    # Stop on shutdown
    stop_subscriber()


app = FastAPI(
    title="BodaBoda Driver Service",
    description="Driver-side service — receives ride requests via MQTT, handles accept/location/complete",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(driver_router, prefix="/driver", tags=["Driver"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "driver_service"}
