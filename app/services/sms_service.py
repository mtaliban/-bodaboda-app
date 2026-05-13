import httpx

from app.core.config import settings
from app.services.email_service import _log_code

_AT_API_URL = "https://api.africastalking.com/version1/messaging"
_AT_SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging"


class SMSService:

    @staticmethod
    async def send_reset_code(phone: str, full_name: str, code: str) -> None:
        if not settings.AT_API_KEY:
            _log_code("SMS", phone, code)
            return

        url = _AT_SANDBOX_URL if settings.AT_USERNAME == "sandbox" else _AT_API_URL
        message = f"Hi {full_name}, your BodaBoda reset code is: {code}. Expires in 10 min."

        payload = {
            "username": settings.AT_USERNAME,
            "to": phone,
            "message": message,
        }
        if settings.AT_SENDER_ID:
            payload["from"] = settings.AT_SENDER_ID

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                url,
                data=payload,
                headers={
                    "apiKey": settings.AT_API_KEY,
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            response.raise_for_status()
