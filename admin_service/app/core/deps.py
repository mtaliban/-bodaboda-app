import os
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

ADMIN_USERNAME  = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD  = os.getenv("ADMIN_PASSWORD", "BodaBoda@Admin2026!")
ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET", "admin-super-secret-key-change-in-prod")
ALGORITHM = "HS256"

bearer_scheme = HTTPBearer()

def create_admin_token() -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=12)
    return jwt.encode({"sub": "admin", "exp": expire}, ADMIN_JWT_SECRET, algorithm=ALGORITHM)

def verify_admin_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        payload = jwt.decode(credentials.credentials, ADMIN_JWT_SECRET, algorithms=[ALGORITHM])
        if payload.get("sub") != "admin":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
