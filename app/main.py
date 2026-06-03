import app.models  # noqa: F401 — registers all models with SQLAlchemy metadata

from typing import List, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel

from app.routers import auth, me
from app.routers.trips import router as trips_router
from app.routers.drivers import router as drivers_router
from app.routers.notifications import router as notifications_router
from app.routers.ws_chat import router as ws_chat_router
from app.metrics import (
    FRONTEND_PAGE_LOADS,
    FRONTEND_PAGE_LOAD_DURATION,
    FRONTEND_BUTTON_CLICKS,
    FRONTEND_API_DURATION,
    FRONTEND_ERRORS,
    ACTIVE_USERS,
    HTTP_REQUEST_BYTES,
    HTTP_RESPONSE_BYTES,
)

app = FastAPI(
    title="BodaBoda Backend",
    description="Ride-hailing backend for BodaBoda motorcycle taxis",
    version="2.0.0",
)

# ── Prometheus instrumentation ────────────────────────────────────────────────
# Exposes /metrics with per-endpoint request counts, durations, status codes,
# and active in-flight requests.
Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    should_instrument_requests_inprogress=True,
    excluded_handlers=["/metrics", "/health", "/frontend-metrics"],
    inprogress_labels=True,
).instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://3.85.53.81",
        "http://3.85.53.81:80",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(me.router, prefix="/auth", tags=["Me"])
app.include_router(trips_router, prefix="/trips", tags=["Trips"])
app.include_router(drivers_router, prefix="/drivers", tags=["Drivers"])
app.include_router(notifications_router, prefix="/notifications", tags=["Notifications"])
app.include_router(ws_chat_router, tags=["WebSocket"])


@app.middleware("http")
async def _track_bytes(request: Request, call_next):
    req_size = int(request.headers.get("content-length", 0))
    response = await call_next(request)
    resp_size = int(response.headers.get("content-length", 0))
    route = request.scope.get("route")
    handler = route.path if route and hasattr(route, "path") else request.url.path
    HTTP_REQUEST_BYTES.labels(handler=handler, method=request.method).observe(req_size)
    HTTP_RESPONSE_BYTES.labels(handler=handler, method=request.method).observe(resp_size)
    return response


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}


# ── Frontend metrics receiver ─────────────────────────────────────────────────

class MetricEvent(BaseModel):
    type: str          # page_load | button_click | api_call | error
    page: Optional[str] = None
    button: Optional[str] = None
    duration_ms: Optional[float] = None
    method: Optional[str] = None
    endpoint: Optional[str] = None
    status: Optional[int] = None
    error_type: Optional[str] = None


class MetricsBatch(BaseModel):
    events: List[MetricEvent]
    active_sessions: Optional[int] = None


@app.post("/frontend-metrics", include_in_schema=False)
async def receive_frontend_metrics(batch: MetricsBatch):
    for ev in batch.events:
        if ev.type == "page_load":
            if ev.page:
                FRONTEND_PAGE_LOADS.labels(page=ev.page).inc()
            if ev.page and ev.duration_ms is not None:
                FRONTEND_PAGE_LOAD_DURATION.labels(page=ev.page).observe(
                    ev.duration_ms / 1000
                )

        elif ev.type == "button_click" and ev.button:
            FRONTEND_BUTTON_CLICKS.labels(button=ev.button).inc()

        elif ev.type == "api_call":
            if ev.method and ev.endpoint and ev.duration_ms is not None:
                FRONTEND_API_DURATION.labels(
                    method=ev.method.upper(),
                    endpoint=ev.endpoint,
                    status=str(ev.status or 0),
                ).observe(ev.duration_ms / 1000)

        elif ev.type == "error":
            FRONTEND_ERRORS.labels(type=ev.error_type or "unhandled").inc()

    if batch.active_sessions is not None:
        ACTIVE_USERS.set(batch.active_sessions)

    return {"ok": True}
