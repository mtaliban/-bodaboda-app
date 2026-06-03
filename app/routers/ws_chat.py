from collections import defaultdict
from typing import Optional
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import decode_access_token
from app.models.user import User

router = APIRouter()

# { trip_id: { conn_id: {"ws", "user_id", "name", "role"} } }
_chat_rooms:   dict[int, dict[str, dict]] = defaultdict(dict)
_signal_rooms: dict[int, dict[str, dict]] = defaultdict(dict)


async def _resolve_user(token: str, db: AsyncSession) -> Optional[User]:
    try:
        payload = decode_access_token(token)
        uid = payload.get("sub")
        if not uid:
            return None
        result = await db.execute(select(User).where(User.id == int(uid)))
        return result.scalar_one_or_none()
    except (JWTError, Exception):
        return None


async def _broadcast(room: dict, msg: dict, exclude: Optional[str] = None) -> None:
    dead = []
    for cid, conn in list(room.items()):
        if cid == exclude:
            continue
        try:
            await conn["ws"].send_json(msg)
        except Exception:
            dead.append(cid)
    for cid in dead:
        room.pop(cid, None)


@router.websocket("/ws/chat/{trip_id}")
async def chat_ws(
    websocket: WebSocket,
    trip_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    user = await _resolve_user(token, db)
    if not user:
        await websocket.close(code=4001)
        return

    conn_id = str(uuid.uuid4())
    await websocket.accept()
    room = _chat_rooms[trip_id]
    room[conn_id] = {
        "ws": websocket,
        "user_id": user.id,
        "name": user.full_name,
        "role": user.role.value,
    }

    try:
        while True:
            data = await websocket.receive_json()
            text = str(data.get("text", "")).strip()[:1000]
            if not text:
                continue
            await _broadcast(room, {
                "type": "message",
                "id": str(uuid.uuid4()),
                "user_id": user.id,
                "name": user.full_name,
                "role": user.role.value,
                "text": text,
                "time": datetime.now(timezone.utc).isoformat(),
            })
    except WebSocketDisconnect:
        room.pop(conn_id, None)
        if not room:
            _chat_rooms.pop(trip_id, None)


@router.websocket("/ws/signal/{trip_id}")
async def signal_ws(
    websocket: WebSocket,
    trip_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """WebRTC signaling relay — forwards SDP offers/answers and ICE candidates between peers."""
    user = await _resolve_user(token, db)
    if not user:
        await websocket.close(code=4001)
        return

    conn_id = str(uuid.uuid4())
    await websocket.accept()
    room = _signal_rooms[trip_id]
    room[conn_id] = {
        "ws": websocket,
        "user_id": user.id,
        "name": user.full_name,
        "role": user.role.value,
    }

    await _broadcast(room, {
        "type": "peer_joined",
        "user_id": user.id,
        "name": user.full_name,
        "role": user.role.value,
    }, exclude=conn_id)

    try:
        while True:
            data = await websocket.receive_json()
            await _broadcast(room, {
                **data,
                "from_user_id": user.id,
                "from_name": user.full_name,
                "from_role": user.role.value,
            }, exclude=conn_id)
    except WebSocketDisconnect:
        room.pop(conn_id, None)
        if not room:
            _signal_rooms.pop(trip_id, None)
        await _broadcast(room, {
            "type": "peer_left",
            "user_id": user.id,
            "name": user.full_name,
        })
