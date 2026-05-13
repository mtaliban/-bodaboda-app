import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger("bodaboda.email")


class EmailService:

    @staticmethod
    async def send_reset_code(to_email: str, full_name: str, code: str) -> None:
        if not settings.SMTP_HOST:
            # ── Development fallback ──────────────────────────────────────────
            # SMTP is not configured. Print the code so you can test without
            # a real mail server. View it with: docker compose logs auth_service
            _log_code("EMAIL", to_email, code)
            return

        msg = MIMEMultipart("alternative")
        msg["Subject"] = "BodaBoda — Your Password Reset Code"
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to_email

        plain = (
            f"Hi {full_name},\n\n"
            f"Your BodaBoda password reset code is:\n\n"
            f"    {code}\n\n"
            f"This code expires in 10 minutes.\n"
            f"If you did not request this, ignore this email.\n\n"
            f"— BodaBoda Team"
        )
        html = f"""
        <html><body style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#e85d04;">BodaBoda Password Reset</h2>
          <p>Hi <strong>{full_name}</strong>,</p>
          <p>Your reset code is:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:12px;
                      padding:16px 24px;background:#f4f4f4;border-radius:8px;
                      display:inline-block;margin:12px 0;">{code}</div>
          <p>This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#888;font-size:12px;">
            If you did not request this, ignore this email.
          </p>
        </body></html>
        """
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))

        # Works with Gmail (port 587 + STARTTLS) and SSL (port 465)
        use_tls = settings.SMTP_PORT == 465
        async with aiosmtplib.SMTP(
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            use_tls=use_tls,
        ) as smtp:
            if settings.SMTP_STARTTLS and not use_tls:
                await smtp.starttls()
            if settings.SMTP_USER:
                await smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            await smtp.send_message(msg)

        logger.info("Reset code email sent to %s", to_email)


def _log_code(channel: str, destination: str, code: str) -> None:
    border = "=" * 60
    print(f"\n{border}")
    print(f"  [BODABODA DEV — {channel} NOT CONFIGURED]")
    print(f"  Destination : {destination}")
    print(f"  Reset code  : {code}")
    print(f"  (Expires in 10 minutes)")
    print(f"{border}\n", flush=True)
    logger.warning(
        "[DEV] %s reset code for %s: %s", channel, destination, code
    )
