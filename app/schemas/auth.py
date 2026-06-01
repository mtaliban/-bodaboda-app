from typing import Optional

from pydantic import BaseModel, EmailStr, model_validator

from app.models.user import UserRole
from app.models.password_reset_token import ResetMethod
from app.schemas.profile import DriverProfileCreate
from app.schemas.user import UserWithProfile


class RegisterRequest(BaseModel):
    full_name: str
    phone: str
    email: EmailStr
    password: str
    role: UserRole
    driver_profile: Optional[DriverProfileCreate] = None

    @model_validator(mode="after")
    def check_driver_profile(self) -> "RegisterRequest":
        if self.role == UserRole.DRIVER and not self.driver_profile:
            raise ValueError("driver_profile is required for DRIVER role")
        return self


class RegisterResponse(BaseModel):
    message: str
    user_id: int


class LoginRequest(BaseModel):
    email_or_phone: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserWithProfile


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LogoutRequest(BaseModel):
    refresh_token: str


class MessageResponse(BaseModel):
    message: str


# ── Email verification ────────────────────────────────────────────────────────

class VerifyEmailRequest(BaseModel):
    user_id: int
    code: str


class ResendVerificationRequest(BaseModel):
    user_id: int


# ── Social auth ───────────────────────────────────────────────────────────────

class SocialDriverProfile(BaseModel):
    license_number: str
    vehicle_model: str
    plate_number: str


class GoogleAuthRequest(BaseModel):
    id_token: str
    role: UserRole = UserRole.RIDER
    phone: Optional[str] = None
    driver_profile: Optional[SocialDriverProfile] = None

    @model_validator(mode="after")
    def check_driver(self) -> "GoogleAuthRequest":
        if self.role == UserRole.DRIVER and not self.driver_profile:
            raise ValueError("driver_profile is required when role is DRIVER")
        return self


class AppleAuthRequest(BaseModel):
    identity_token: str
    full_name: Optional[str] = None
    role: UserRole = UserRole.RIDER
    phone: Optional[str] = None
    driver_profile: Optional[SocialDriverProfile] = None

    @model_validator(mode="after")
    def check_driver(self) -> "AppleAuthRequest":
        if self.role == UserRole.DRIVER and not self.driver_profile:
            raise ValueError("driver_profile is required when role is DRIVER")
        return self


# ── Password reset ────────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email_or_phone: str
    method: ResetMethod


class VerifyResetCodeRequest(BaseModel):
    email_or_phone: str
    code: str


class VerifyResetCodeResponse(BaseModel):
    reset_token: str
    message: str


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str

    @model_validator(mode="after")
    def check_password_length(self) -> "ResetPasswordRequest":
        if len(self.new_password) < 6:
            raise ValueError("new_password must be at least 6 characters")
        return self
