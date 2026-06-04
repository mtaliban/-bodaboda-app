import asyncio
import json
import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import (
    ADMIN_USERNAME, ADMIN_PASSWORD,
    create_admin_token, verify_admin_token,
)

router = APIRouter()

# ── In-memory event queue for WebSocket broadcast ────────────────────────────
_event_queues: list[asyncio.Queue] = []


def broadcast_event(event: dict):
    for q in list(_event_queues):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


# ── Login ─────────────────────────────────────────────────────────────────────
@router.post("/login")
async def admin_login(body: dict):
    if body.get("username") != ADMIN_USERNAME or body.get("password") != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"access_token": create_admin_token(), "token_type": "bearer"}


# ── Stats ─────────────────────────────────────────────────────────────────────
@router.get("/stats", dependencies=[Depends(verify_admin_token)])
async def get_stats(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM users WHERE role = 'RIDER') AS riders,
          (SELECT COUNT(*) FROM users WHERE role = 'DRIVER') AS drivers,
          (SELECT COUNT(*) FROM trips) AS total_trips,
          (SELECT COUNT(*) FROM trips WHERE status IN ('SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS')) AS active_trips,
          (SELECT COUNT(*) FROM trips WHERE status = 'COMPLETED') AS completed_trips,
          (SELECT COUNT(*) FROM trips WHERE status = 'CANCELLED') AS cancelled_trips,
          (SELECT COUNT(*) FROM driver_profiles WHERE verification_status = 'PENDING') AS pending_verifications
    """))
    row = rows.mappings().one()
    return dict(row)


# ── Users ─────────────────────────────────────────────────────────────────────
@router.get("/users", dependencies=[Depends(verify_admin_token)])
async def get_users(page: int = 1, limit: int = 30, db: AsyncSession = Depends(get_db)):
    offset = (page - 1) * limit
    result = await db.execute(text("""
        SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.created_at,
               u.email_verified,
               dp.verification_status AS driver_verification
        FROM users u
        LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        ORDER BY u.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {"limit": limit, "offset": offset})
    users = [dict(r) for r in result.mappings()]
    total = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar()
    return {"users": users, "total": total, "page": page, "limit": limit}


# ── Trips ─────────────────────────────────────────────────────────────────────
@router.get("/trips", dependencies=[Depends(verify_admin_token)])
async def get_trips(page: int = 1, limit: int = 30, status: str = "", db: AsyncSession = Depends(get_db)):
    offset = (page - 1) * limit
    where = "WHERE t.status = :status" if status else ""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if status:
        params["status"] = status
    result = await db.execute(text(f"""
        SELECT t.id, t.trip_name, t.pickup_address, t.destination_address,
               t.status, t.ride_type, t.payment_method, t.created_at,
               u.full_name AS rider_name, u.phone AS rider_phone
        FROM trips t
        JOIN users u ON u.id = t.rider_id
        {where}
        ORDER BY t.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params)
    trips = [dict(r) for r in result.mappings()]
    count_q = f"SELECT COUNT(*) FROM trips {'WHERE status = :status' if status else ''}"
    count_params = {"status": status} if status else {}
    total = (await db.execute(text(count_q), count_params)).scalar()
    return {"trips": trips, "total": total, "page": page, "limit": limit}


# ── Drivers ───────────────────────────────────────────────────────────────────
@router.get("/drivers", dependencies=[Depends(verify_admin_token)])
async def get_drivers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT u.id AS user_id, u.full_name, u.email, u.phone, u.status AS account_status,
               dp.id AS profile_id, dp.license_number, dp.vehicle_model, dp.plate_number,
               dp.verification_status,
               d.status AS driver_status, d.rating, d.total_trips
        FROM users u
        JOIN driver_profiles dp ON dp.user_id = u.id
        LEFT JOIN drivers d ON d.driver_profile_id = dp.id
        WHERE u.role = 'DRIVER'
        ORDER BY u.created_at DESC
    """))
    return [dict(r) for r in result.mappings()]


# ── Verify Driver ─────────────────────────────────────────────────────────────
@router.patch("/drivers/{profile_id}/verify", dependencies=[Depends(verify_admin_token)])
async def verify_driver(profile_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    new_status = body.get("status")
    if new_status not in ("VERIFIED", "REJECTED"):
        raise HTTPException(status_code=400, detail="status must be VERIFIED or REJECTED")
    await db.execute(
        text("UPDATE driver_profiles SET verification_status = :s WHERE id = :id"),
        {"s": new_status, "id": profile_id}
    )
    await db.commit()
    return {"ok": True, "status": new_status}


# ── Suspend / Activate User ───────────────────────────────────────────────────
@router.patch("/users/{user_id}/status", dependencies=[Depends(verify_admin_token)])
async def update_user_status(user_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    new_status = body.get("status")
    if new_status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="status must be active or suspended")
    await db.execute(
        text("UPDATE users SET status = :s WHERE id = :id"),
        {"s": new_status, "id": user_id}
    )
    await db.commit()
    return {"ok": True, "status": new_status}


# ── WebSocket — real-time event feed ─────────────────────────────────────────
@router.websocket("/ws")
async def admin_ws(websocket: WebSocket):
    # Simple token check via query param
    token = websocket.query_params.get("token", "")
    from jose import JWTError, jwt
    from app.core.deps import ADMIN_JWT_SECRET, ALGORITHM
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=[ALGORITHM])
        if payload.get("sub") != "admin":
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _event_queues.append(q)
    try:
        while True:
            event = await q.get()
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        pass
    finally:
        _event_queues.remove(q)
