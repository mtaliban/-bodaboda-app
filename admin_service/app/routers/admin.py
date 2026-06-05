import asyncio
import json
import os
import random
from datetime import datetime, timezone
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


# ── Edit User Profile ─────────────────────────────────────────────────────────
@router.patch("/users/{user_id}/profile", dependencies=[Depends(verify_admin_token)])
async def edit_user_profile(user_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    fields = {k: v for k, v in body.items() if k in ("full_name", "email", "phone")}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["uid"] = user_id
    await db.execute(text(f"UPDATE users SET {set_clause} WHERE id = :uid"), fields)
    await db.commit()
    return {"ok": True}


# ── Reset User Password ───────────────────────────────────────────────────────
@router.post("/users/{user_id}/reset-password", dependencies=[Depends(verify_admin_token)])
async def reset_user_password(user_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    new_password = body.get("password", "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password lazima iwe na herufi 6+")
    from passlib.context import CryptContext
    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    hashed = pwd_ctx.hash(new_password)
    await db.execute(text("UPDATE users SET password_hash = :h WHERE id = :id"), {"h": hashed, "id": user_id})
    await db.commit()
    return {"ok": True}


# ── Edit Driver Profile ───────────────────────────────────────────────────────
@router.patch("/drivers/{user_id}/edit", dependencies=[Depends(verify_admin_token)])
async def edit_driver(user_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    user_fields = {k: v for k, v in body.items() if k in ("full_name", "email", "phone", "role", "status")}
    driver_fields = {k: v for k, v in body.items() if k in ("license_number", "vehicle_model", "plate_number", "verification_status")}
    if user_fields:
        set_u = ", ".join(f"{k} = :{k}" for k in user_fields)
        user_fields["uid"] = user_id
        await db.execute(text(f"UPDATE users SET {set_u} WHERE id = :uid"), user_fields)
    if driver_fields:
        set_d = ", ".join(f"{k} = :{k}" for k in driver_fields)
        driver_fields["uid"] = user_id
        await db.execute(text(f"UPDATE driver_profiles SET {set_d} WHERE user_id = :uid"), driver_fields)
    await db.commit()
    return {"ok": True}


# ── Edit Trip ─────────────────────────────────────────────────────────────────
@router.patch("/trips/{trip_id}/edit", dependencies=[Depends(verify_admin_token)])
async def edit_trip(trip_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    fields = {k: v for k, v in body.items() if k in ("status", "pickup_address", "destination_address", "trip_name")}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["tid"] = trip_id
    await db.execute(text(f"UPDATE trips SET {set_clause} WHERE id = :tid"), fields)
    await db.commit()
    return {"ok": True}


# ── Delete User ───────────────────────────────────────────────────────────────
@router.delete("/users/{user_id}", dependencies=[Depends(verify_admin_token)])
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
    await db.commit()
    return {"ok": True}


# ── Historical Events (trip status history) ───────────────────────────────────
@router.get("/events/history", dependencies=[Depends(verify_admin_token)])
async def get_events_history(limit: int = 200, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT tsh.id, tsh.trip_id, tsh.status AS event_type, tsh.changed_by,
               tsh.created_at AS timestamp,
               t.trip_name, t.pickup_address, t.destination_address,
               u.full_name AS rider_name
        FROM trip_status_history tsh
        JOIN trips t ON t.id = tsh.trip_id
        JOIN users u ON u.id = t.rider_id
        ORDER BY tsh.created_at DESC
        LIMIT :limit
    """), {"limit": limit})
    return [dict(r) for r in result.mappings()]


# ── Wallet Transactions (all users) ──────────────────────────────────────────
@router.get("/wallet/transactions", dependencies=[Depends(verify_admin_token)])
async def get_wallet_transactions(limit: int = 200, db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT wt.id, wt.user_id, wt.type, wt.amount::float AS amount,
               wt.balance_after::float AS balance_after,
               wt.trip_id, wt.description, wt.created_at,
               u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role
        FROM wallet_transactions wt
        JOIN users u ON u.id = wt.user_id
        ORDER BY wt.created_at DESC
        LIMIT :limit
    """), {"limit": limit})
    return [dict(r) for r in result.mappings()]


# ── Admin Earnings (10% platform cut from each trip) ─────────────────────────
@router.get("/earnings", dependencies=[Depends(verify_admin_token)])
async def get_admin_earnings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT ae.id, ae.trip_id, ae.amount::float AS amount, ae.created_at,
               t.pickup_address, t.destination_address, t.fare_tzs
        FROM admin_earnings ae
        LEFT JOIN trips t ON t.id = ae.trip_id
        ORDER BY ae.created_at DESC
        LIMIT 500
    """))
    rows = [dict(r) for r in result.mappings()]
    total = sum(r['amount'] for r in rows)
    return {"total": round(total, 2), "count": len(rows), "earnings": rows}


# ── Virtual Cards (all users) ─────────────────────────────────────────────────
@router.get("/wallet/cards", dependencies=[Depends(verify_admin_token)])
async def get_virtual_cards(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT vc.id, vc.user_id, vc.card_number,
               vc.expiry_month, vc.expiry_year, vc.created_at,
               u.full_name AS user_name, u.phone AS user_phone, u.role AS user_role
        FROM virtual_cards vc
        JOIN users u ON u.id = vc.user_id
        ORDER BY vc.created_at DESC
    """))
    return [dict(r) for r in result.mappings()]


# ── Extend Virtual Card Expiry ────────────────────────────────────────────────
@router.patch("/wallet/cards/{card_id}/extend", dependencies=[Depends(verify_admin_token)])
async def extend_virtual_card(card_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    months = int(body.get("months", 12))
    if months < 1 or months > 60:
        raise HTTPException(status_code=400, detail="months must be 1-60")
    result = await db.execute(text("SELECT expiry_month, expiry_year FROM virtual_cards WHERE id = :id"), {"id": card_id})
    row = result.mappings().one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Card not found")
    total_months = row["expiry_month"] - 1 + row["expiry_year"] * 12 + months
    new_year = total_months // 12
    new_month = total_months % 12 + 1
    await db.execute(
        text("UPDATE virtual_cards SET expiry_month = :m, expiry_year = :y WHERE id = :id"),
        {"m": new_month, "y": new_year, "id": card_id}
    )
    await db.commit()
    return {"ok": True, "new_expiry": f"{str(new_month).zfill(2)}/{new_year}"}


# ── Delete Virtual Card (burn) ────────────────────────────────────────────────
@router.delete("/wallet/cards/{card_id}", dependencies=[Depends(verify_admin_token)])
async def delete_virtual_card(card_id: int, db: AsyncSession = Depends(get_db)):
    # Fetch user_id before deleting so we can notify them
    info = await db.execute(text("SELECT user_id FROM virtual_cards WHERE id = :id"), {"id": card_id})
    row = info.mappings().one_or_none()
    if row:
        uid = row["user_id"]
        profile_row = await db.execute(text("""
            SELECT u.role,
                   COALESCE(rp.id, dp.id) AS profile_id
            FROM users u
            LEFT JOIN rider_profiles rp ON rp.user_id = u.id AND u.role = 'RIDER'
            LEFT JOIN driver_profiles dp ON dp.user_id = u.id AND u.role = 'DRIVER'
            WHERE u.id = :uid
        """), {"uid": uid})
        pr = profile_row.mappings().one_or_none()
        if pr and pr["profile_id"]:
            await db.execute(text("""
                INSERT INTO notifications (recipient_role, recipient_profile_id, title, message, type, is_read)
                VALUES (:role, :pid, 'Kadi ya Mkoba Imefutwa', 'Kadi yako ya mkoba wa BodaBoda imefutwa na msimamizi.', 'CARD_BURNED', FALSE)
            """), {"role": pr["role"], "pid": pr["profile_id"]})
    await db.execute(text("DELETE FROM virtual_cards WHERE id = :id"), {"id": card_id})
    await db.commit()
    return {"ok": True}


def _gen_card_number() -> str:
    digits = [4] + [random.randint(0, 9) for _ in range(15)]
    return ' '.join(''.join(str(d) for d in digits[i:i+4]) for i in range(0, 16, 4))


# ── Create Virtual Card for user (admin) ──────────────────────────────────────
@router.post("/wallet/cards/user/{user_id}", dependencies=[Depends(verify_admin_token)])
async def create_card_for_user(user_id: int, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(text("SELECT id FROM virtual_cards WHERE user_id = :uid"), {"uid": user_id})
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Mtumiaji tayari ana kadi ya mkoba")
    now = datetime.now(timezone.utc)
    card_number = _gen_card_number()
    expiry_month = random.randint(1, 12)
    expiry_year = now.year + random.randint(3, 5)
    cvv = str(random.randint(100, 999))
    result = await db.execute(text("""
        INSERT INTO virtual_cards (user_id, card_number, expiry_month, expiry_year, cvv)
        VALUES (:uid, :cn, :em, :ey, :cvv) RETURNING id, created_at
    """), {"uid": user_id, "cn": card_number, "em": expiry_month, "ey": expiry_year, "cvv": cvv})
    new_row = result.mappings().one()
    # Notify user
    profile_row = await db.execute(text("""
        SELECT u.role, u.full_name,
               COALESCE(rp.id, dp.id) AS profile_id
        FROM users u
        LEFT JOIN rider_profiles rp ON rp.user_id = u.id AND u.role = 'RIDER'
        LEFT JOIN driver_profiles dp ON dp.user_id = u.id AND u.role = 'DRIVER'
        WHERE u.id = :uid
    """), {"uid": user_id})
    pr = profile_row.mappings().one_or_none()
    if pr and pr["profile_id"]:
        await db.execute(text("""
            INSERT INTO notifications (recipient_role, recipient_profile_id, title, message, type, is_read)
            VALUES (:role, :pid, 'Kadi ya Mkoba Imetengenezwa', 'Kadi yako ya mkoba wa BodaBoda imetengenezwa na msimamizi. Inaweza kutumika sasa.', 'CARD_CREATED', FALSE)
        """), {"role": pr["role"], "pid": pr["profile_id"]})
    await db.commit()
    user_name = pr["full_name"] if pr else "—"
    return {
        "ok": True,
        "id": new_row["id"],
        "user_id": user_id,
        "user_name": user_name,
        "user_phone": None,
        "user_role": pr["role"] if pr else None,
        "card_number": card_number,
        "expiry_month": expiry_month,
        "expiry_year": expiry_year,
        "created_at": new_row["created_at"],
    }


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
