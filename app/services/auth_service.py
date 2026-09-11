"""
Phone-based authentication.
Flow:
  1. User submits phone number → backend generates OTP, sends via SMS
  2. User submits OTP → backend validates, issues JWT
  3. JWT is used for all subsequent API calls

In development, OTP is returned in the response (no SMS needed).
In production, OTP is sent via Africa's Talking SMS API.
"""
import secrets
import logging
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.models import User
from app.schemas.schemas import normalize_kenyan_phone

settings = get_settings()
logger = logging.getLogger(__name__)

# Simple in-memory OTP store — replace with Redis in production
# Structure: { phone_number: { "otp": "123456", "expires_at": timestamp } }
_otp_store: dict = {}


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP."""
    return str(secrets.randbelow(900000) + 100000)  # 100000–999999


def store_otp(phone_number: str, otp: str):
    """Store OTP with expiry."""
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_EXPIRE_SECONDS)
    _otp_store[phone_number] = {"otp": otp, "expires_at": expires_at}


def verify_otp(phone_number: str, otp_code: str) -> bool:
    """Check OTP is correct and not expired."""
    record = _otp_store.get(phone_number)
    if not record:
        return False
    if datetime.now(timezone.utc) > record["expires_at"]:
        del _otp_store[phone_number]
        return False
    if record["otp"] != otp_code:
        return False
    # Consume OTP — one-time use
    del _otp_store[phone_number]
    return True


async def send_otp_sms(phone_number: str, otp: str):
    """
    Send OTP via Africa's Talking SMS.
    In sandbox mode, this logs to console instead.
    """
    if settings.APP_ENV == "development" or settings.AFRICASTALKING_USERNAME == "sandbox":
        logger.info(f"[DEV] OTP for {phone_number}: {otp}")
        return

    try:
        import africastalking
        africastalking.initialize(settings.AFRICASTALKING_USERNAME, settings.AFRICASTALKING_API_KEY)
        sms = africastalking.SMS
        sms.send(
            message=f"Your TiketiKE verification code is: {otp}. Valid for 5 minutes.",
            recipients=[f"+{phone_number}"],
            sender_id="TIKETI",
        )
        logger.info(f"OTP SMS sent to {phone_number}")
    except Exception as e:
        logger.error(f"SMS send failed for {phone_number}: {e}")
        raise


def get_or_create_user(db: Session, phone_number: str) -> User:
    """Fetch existing user or create a new one by phone number."""
    user = db.query(User).filter(User.phone_number == phone_number).first()
    if not user:
        user = User(phone_number=phone_number)
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"New user created: {phone_number}")
    return user


def create_access_token(user_id: str, phone_number: str) -> str:
    """Issue a JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "phone": phone_number,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises JWTError on failure."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
