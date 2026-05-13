from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(
        self,
        *,
        recipient_role: str,
        recipient_profile_id: int,
        title: str,
        message: str,
        type: str,
        related_trip_id: Optional[int] = None,
        related_offer_id: Optional[int] = None,
    ) -> Optional[Notification]:
        # Dedup: skip if identical notification already exists.
        # SQLAlchemy translates `== None` to `IS NULL`, so None values match correctly.
        existing = await self.db.execute(
            select(Notification).where(
                Notification.recipient_role == recipient_role,
                Notification.recipient_profile_id == recipient_profile_id,
                Notification.type == type,
                Notification.related_trip_id == related_trip_id,
                Notification.related_offer_id == related_offer_id,
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            return None

        notif = Notification(
            recipient_role=recipient_role,
            recipient_profile_id=recipient_profile_id,
            title=title,
            message=message,
            type=type,
            related_trip_id=related_trip_id,
            related_offer_id=related_offer_id,
        )
        self.db.add(notif)
        return notif

    async def get_for_user(self, role: str, profile_id: int) -> list[Notification]:
        result = await self.db.execute(
            select(Notification)
            .where(
                Notification.recipient_role == role,
                Notification.recipient_profile_id == profile_id,
            )
            .order_by(Notification.created_at.desc())
        )
        return list(result.scalars().all())

    async def mark_read(
        self, notification_id: int, role: str, profile_id: int
    ) -> Optional[Notification]:
        result = await self.db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.recipient_role == role,
                Notification.recipient_profile_id == profile_id,
            )
        )
        notif = result.scalar_one_or_none()
        if notif:
            notif.is_read = True
            await self.db.commit()
            await self.db.refresh(notif)
        return notif
