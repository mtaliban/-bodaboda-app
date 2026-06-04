from collections import defaultdict
from typing import Optional
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from jose import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db, AsyncSessionLocal
from app.core.security import decode_access_token
from app.models.user import User
from app.models.chat_message import ChatMessage

router = APIRouter()

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


@router.get("/chat/{trip_id}/history")
async def get_chat_history(trip_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.trip_id == trip_id, ChatMessage.is_deleted == False)
        .order_by(ChatMessage.created_at)
        .limit(200)
    )
    msgs = result.scalars().all()
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "role": m.role,
            "name": m.sender_name,
            "text": m.message,
            "image_url": m.image_url,
            "time": m.created_at.isoformat(),
            "read_at": m.read_at.isoformat() if m.read_at else None,
        }
        for m in msgs
    ]


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

    # Mark unread messages as read (messages from the OTHER party)
    async with AsyncSessionLocal() as sess:
        await sess.execute(
            update(ChatMessage)
            .where(
                ChatMessage.trip_id == trip_id,
                ChatMessage.role != user.role.value,
                ChatMessage.read_at == None,
                ChatMessage.is_deleted == False,
            )
            .values(read_at=datetime.now(timezone.utc))
        )
        await sess.commit()

    # Notify others in the room that messages are now read
    await _broadcast(room, {
        "type": "read_by",
        "role": user.role.value,
        "at": datetime.now(timezone.utc).isoformat(),
    }, exclude=conn_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")

            if msg_type == "delete":
                msg_id = data.get("id")
                if msg_id:
                    async with AsyncSessionLocal() as sess:
                        await sess.execute(
                            update(ChatMessage)
                            .where(ChatMessage.id == int(msg_id), ChatMessage.user_id == user.id)
                            .values(is_deleted=True)
                        )
                        await sess.commit()
                    await _broadcast(room, {"type": "deleted", "id": msg_id})
                continue

            text = str(data.get("text", "")).strip()[:1000]
            image_url = data.get("image_url")
            if not text and not image_url:
                continue

            now = datetime.now(timezone.utc)
            read_at = now if len(room) > 1 else None

            async with AsyncSessionLocal() as sess:
                cm = ChatMessage(
                    trip_id=trip_id,
                    user_id=user.id,
                    role=user.role.value,
                    sender_name=user.full_name,
                    message=text or None,
                    image_url=image_url or None,
                    read_at=read_at,
                )
                sess.add(cm)
                await sess.commit()
                await sess.refresh(cm)
                msg_id = cm.id

            await _broadcast(room, {
                "type": "message",
                "id": msg_id,
                "user_id": user.id,
                "name": user.full_name,
                "role": user.role.value,
                "text": text,
                "image_url": image_url,
                "time": now.isoformat(),
                "read_at": read_at.isoformat() if read_at else None,
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
    """WebRTC signaling relay."""
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
