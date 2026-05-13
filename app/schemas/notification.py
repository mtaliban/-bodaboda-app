from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    recipient_role: str
    recipient_profile_id: int
    title: str
    message: str
    type: str
    related_trip_id: Optional[int] = None
    related_offer_id: Optional[int] = None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
