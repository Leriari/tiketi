"""
Phone-based authentication.
Flow:
  1. User submits phone number → backend generates OTP
  2. User submits OTP → backend validates, issues JWT
  3. JWT is used for all subsequent API calls

OTP delivery is pluggable — see app/services/otp_delivery.py (Work Order 04
A5). This module owns only the OTP's lifecycle (generate/store/verify),
not how it reaches the user.
"""
import json
import secrets
import logging
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.redis_client import get_redis_client
from app.models.models import User
from app.schemas.schemas import normalize_kenyan_phone

settings = get_settings()
logger = logging.getLogger(__name__)

# Wrong-attempt ceiling before a code is invalidated outright (Work Order 04
# A2) — six digits is a million combinations, which is not much against an
# endpoint with no limit at all.
MAX_OTP_ATTEMPTS = 5

_OTP_KEY_PREFIX = "otp:"


def _otp_key(phone_number: str) -> str:
    return f"{_OTP_KEY_PREFIX}{phone_number}"


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP."""
    return str(secrets.randbelow(900000) + 100000)  # 100000–999999


def store_otp(phone_number: str, otp: str):
    """
    Store the OTP in Redis with a TTL matching OTP_EXPIRE_SECONDS — expiry
    is Redis's job, not this code's. Replaces any OTP already pending for
    this number (a fresh request supersedes an old, unconsumed code) and
    resets the attempt counter.
    """
    redis_client = get_redis_client()
    redis_client.setex(
        _otp_key(phone_number),
        settings.OTP_EXPIRE_SECONDS,
        json.dumps({"otp": otp, "attempts": 0}),
    )


def verify_otp(phone_number: str, otp_code: str) -> bool:
    """
    Check the OTP is correct, not expired (Redis TTL handles that — a
    missing key means either it never existed or it expired), and has not
    already exceeded MAX_OTP_ATTEMPTS wrong guesses. Single-use: a
    successful verification deletes the key immediately so the same code
    cannot be replayed.
    """
    redis_client = get_redis_client()
    key = _otp_key(phone_number)
    raw = redis_client.get(key)
    if not raw:
        return False

    record = json.loads(raw)
    if record["attempts"] >= MAX_OTP_ATTEMPTS:
        # Already exhausted on a previous call — refuse to decide based on
        # any further guess and evict the code outright.
        redis_client.delete(key)
        return False

    if record["otp"] != otp_code:
        record["attempts"] += 1
        remaining_ttl = redis_client.ttl(key)
        if remaining_ttl <= 0:
            remaining_ttl = settings.OTP_EXPIRE_SECONDS
        if record["attempts"] >= MAX_OTP_ATTEMPTS:
            redis_client.delete(key)
        else:
            redis_client.setex(key, remaining_ttl, json.dumps(record))
        return False

    # Consume OTP — one-time use.
    redis_client.delete(key)
    return True


async def send_otp_sms(phone_number: str, otp: str):
    """
    SMS delivery is out of scope for this project. Logs the OTP to console
    so it reaches the developer during testing.

    Note (Work Order 04 A5): this becomes a pluggable delivery abstraction
    in app/services/otp_delivery.py — left as a plain console log for now
    so Block A's earlier tasks (A1-A4) land as independent, reviewable
    commits before that refactor.
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
