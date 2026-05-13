from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import get_db
from app.core.security import create_access_token
from app.metrics import LOGIN_ATTEMPTS, REGISTER_ATTEMPTS
from app.models.user import User, UserRole
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    RefreshRequest,
    RefreshResponse,
    LogoutRequest,
    MessageResponse,
    ForgotPasswordRequest,
    VerifyResetCodeRequest,
    VerifyResetCodeResponse,
    ResetPasswordRequest,
)
from app.schemas.user import UserWithProfile
from app.services.auth_service import AuthService
from app.services.token_service import TokenService
from app.services.password_reset_service import PasswordResetService

router = APIRouter()


@router.post("/register", response_model=UserWithProfile, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    try:
        user = await service.register(data)
        REGISTER_ATTEMPTS.labels(status="success").inc()
        return UserWithProfile.model_validate(user)
    except HTTPException:
        REGISTER_ATTEMPTS.labels(status="failed").inc()
        raise


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    try:
        user, access_token, refresh_token = await service.login(data)
        LOGIN_ATTEMPTS.labels(status="success").inc()
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user=UserWithProfile.model_validate(user),
        )
    except HTTPException:
        LOGIN_ATTEMPTS.labels(status="failed").inc()
        raise


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_service = TokenService(db)
    token_record = await token_service.get_valid_token(data.refresh_token)

    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    result = await db.execute(
        select(User)
        .where(User.id == token_record.user_id)
        .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    payload: dict = {"sub": str(user.id), "role": user.role.value}
    if user.role == UserRole.RIDER and user.rider_profile:
        payload["rider_profile_id"] = user.rider_profile.id
    elif user.role == UserRole.DRIVER and user.driver_profile:
        payload["driver_profile_id"] = user.driver_profile.id

    access_token = create_access_token(payload)
    return RefreshResponse(access_token=access_token)


@router.post("/logout", response_model=MessageResponse)
async def logout(data: LogoutRequest, db: AsyncSession = Depends(get_db)):
    token_service = TokenService(db)
    await token_service.revoke_token(data.refresh_token)
    return MessageResponse(message="Successfully logged out")


# ── Password reset ────────────────────────────────────────────────────────────

@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    svc = PasswordResetService(db)
    message = await svc.initiate_reset(data.email_or_phone, data.method)
    return MessageResponse(message=message)


@router.post("/verify-reset-code", response_model=VerifyResetCodeResponse)
async def verify_reset_code(data: VerifyResetCodeRequest, db: AsyncSession = Depends(get_db)):
    svc = PasswordResetService(db)
    reset_token = await svc.verify_code(data.email_or_phone, data.code)
    return VerifyResetCodeResponse(
        reset_token=reset_token,
        message="Code verified. Use the reset_token to set your new password.",
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    svc = PasswordResetService(db)
    await svc.reset_password(data.reset_token, data.new_password)
    return MessageResponse(message="Password reset successfully. You can now log in.")
