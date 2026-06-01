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
    RegisterResponse,
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
    VerifyEmailRequest,
    ResendVerificationRequest,
    GoogleAuthRequest,
    AppleAuthRequest,
)
from app.schemas.user import UserWithProfile
from app.services.auth_service import AuthService
from app.services.email_verification_service import EmailVerificationService
from app.services.password_reset_service import PasswordResetService
from app.services.social_auth_service import SocialAuthService
from app.services.token_service import TokenService

router = APIRouter()


# ── Registration ──────────────────────────────────────────────────────────────

@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    try:
        user = await service.register(data)
        REGISTER_ATTEMPTS.labels(status="success").inc()
    except HTTPException:
        REGISTER_ATTEMPTS.labels(status="failed").inc()
        raise

    # Send verification code to email
    verification_svc = EmailVerificationService(db)
    await verification_svc.send_code(user)

    return RegisterResponse(
        message=f"Account created. A 6-digit verification code has been sent to {user.email}",
        user_id=user.id,
    )


@router.post("/verify-email", response_model=TokenResponse)
async def verify_email(data: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    """Verify the 6-digit code sent to email after registration. Returns tokens on success."""
    verification_svc = EmailVerificationService(db)
    user = await verification_svc.verify_code(data.user_id, data.code)

    # Load relationships for response
    result = await db.execute(
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.rider_profile), selectinload(User.driver_profile))
    )
    user = result.scalar_one()

    token_service = TokenService(db)
    payload: dict = {"sub": str(user.id), "role": user.role.value}
    if user.role == UserRole.RIDER and user.rider_profile:
        payload["rider_profile_id"] = user.rider_profile.id
    elif user.role == UserRole.DRIVER and user.driver_profile:
        payload["driver_profile_id"] = user.driver_profile.id

    access_token = create_access_token(payload)
    refresh_token = await token_service.create_refresh_token(user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserWithProfile.model_validate(user),
    )


@router.post("/resend-verification", response_model=MessageResponse)
async def resend_verification(data: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    """Resend verification code to the user's email (rate-limited: 1 per minute)."""
    result = await db.execute(select(User).where(User.id == data.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already verified")

    verification_svc = EmailVerificationService(db)
    await verification_svc.send_code(user)
    return MessageResponse(message=f"Verification code resent to {user.email}")


# ── Login ─────────────────────────────────────────────────────────────────────

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


# ── Social Auth ───────────────────────────────────────────────────────────────

@router.post("/google", response_model=TokenResponse)
async def google_auth(data: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    """Sign in / sign up with Google. Send the Google ID token from the frontend SDK."""
    svc = SocialAuthService(db)

    claims = await svc.verify_google_token(data.id_token)

    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google token has no email")

    full_name = claims.get("name") or email.split("@")[0]

    user, access_token, refresh_token = await svc.get_or_create_user(
        email=email,
        full_name=full_name,
        provider="google",
        role=data.role,
        phone=data.phone,
        driver_profile_data=data.driver_profile,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserWithProfile.model_validate(user),
    )


@router.post("/apple", response_model=TokenResponse)
async def apple_auth(data: AppleAuthRequest, db: AsyncSession = Depends(get_db)):
    """Sign in / sign up with Apple. Send the Apple identity token from the frontend SDK."""
    svc = SocialAuthService(db)

    claims = await svc.verify_apple_token(data.identity_token)

    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Apple token has no email")

    # Apple only provides name on first sign-in; after that it's empty
    full_name = data.full_name or email.split("@")[0]

    user, access_token, refresh_token = await svc.get_or_create_user(
        email=email,
        full_name=full_name,
        provider="apple",
        role=data.role,
        phone=data.phone,
        driver_profile_data=data.driver_profile,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserWithProfile.model_validate(user),
    )


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
