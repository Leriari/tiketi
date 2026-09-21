"""
Phone-based authentication.
Flow:
  1. User submits phone number → backend generates OTP
  2. User submits OTP → backend validates, issues JWT
  3. JWT is used for all subsequent API calls

OTP delivery is logged to console only — real SMS sending is out of
scope for this project. The OTP is also returned directly in the
request-otp response in development mode.
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
    SMS delivery is out of scope for this project. Logs the OTP to console
    so it reaches the developer during testing.
    """
    logger.info(f"[DEV] OTP for {phone_number}: {otp}")


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
