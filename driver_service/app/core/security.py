from jose import jwt
from app.core.config import settings


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.ALGORITHM])
