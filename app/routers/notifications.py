from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.schemas.notification import NotificationOut
from app.services.notification_service import NotificationService

router = APIRouter()


def _role_and_profile_id(user: User) -> tuple[str, int]:
    if user.role == UserRole.RIDER:
        if not user.rider_profile:
            raise HTTPException(status_code=400, detail="Rider profile not found")
        return "RIDER", user.rider_profile.id
    else:
        if not user.driver_profile:
            raise HTTPException(status_code=400, detail="Driver profile not found")
        return "DRIVER", user.driver_profile.id


@router.get("/my", response_model=list[NotificationOut])
async def my_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role, profile_id = _role_and_profile_id(current_user)
    svc = NotificationService(db)
    notifications = await svc.get_for_user(role, profile_id)
    return [NotificationOut.model_validate(n) for n in notifications]


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role, profile_id = _role_and_profile_id(current_user)
    svc = NotificationService(db)
    notif = await svc.mark_read(notification_id, role, profile_id)
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationOut.model_validate(notif)
