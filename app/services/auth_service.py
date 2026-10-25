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


def peek_otp(phone_number: str) -> str | None:
    """
    Read-only: the current pending OTP for a phone number, without
    consuming it or counting it as an attempt. Used only by the dev-only
    GET /dev/otp-inbox endpoint (app/api/routes/dev.py) — never by any
    authentication decision path.
    """
    raw = get_redis_client().get(_otp_key(phone_number))
    if not raw:
        return None
    return json.loads(raw)["otp"]


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


def create_access_token(user_id: str, phone_number: str, session_version: int = 0) -> str:
    """Issue a JWT access token. `sv` ties it to the user's session_version
    so "sign out everywhere" can invalidate every earlier token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "phone": phone_number,
        "sv": session_version,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises JWTError on failure."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


# ── Firebase sign-in (phone SMS + Google) ────────────────────────────────────
# Firebase proves who someone is: a phone number it sent an SMS code to, or
# a Google account. Everything in this platform (M-Pesa, team invites,
# ticket ownership) keys off a verified phone, so a Google account is only
# ever *linked* to a phone-verified user: the first time, POST
# /auth/firebase hands back a short-lived link token, and the follow-up
# phone sign-in passes it back to attach the Google account to that phone's
# user (created if new).

GOOGLE_LINK_TTL = timedelta(minutes=10)


def verify_firebase_token(token: str) -> dict:
    """Validate a Firebase Authentication ID token against Google's keys and
    this project. Returns its claims; raises ValueError if it's forged,
    expired, or from another Firebase project."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    claims = id_token.verify_firebase_token(token, google_requests.Request(), audience=settings.FIREBASE_PROJECT_ID)
    if not claims or claims.get("iss") != f"https://securetoken.google.com/{settings.FIREBASE_PROJECT_ID}":
        raise ValueError("Wrong issuer")
    return claims


def _link_key() -> str:
    # A different key from access tokens, so a link token can never be
    # accepted as a session (and vice versa).
    return f"{settings.SECRET_KEY}:google-link"


def create_google_link_token(google_sub: str, email: str | None) -> str:
    payload = {
        "typ": "google_link",
        "google_sub": google_sub,
        "email": email,
        "exp": datetime.now(timezone.utc) + GOOGLE_LINK_TTL,
    }
    return jwt.encode(payload, _link_key(), algorithm=settings.JWT_ALGORITHM)


def decode_google_link_token(token: str) -> dict:
    """Raises JWTError (incl. expiry) or ValueError for anything that isn't
    a link token this server issued."""
    claims = jwt.decode(token, _link_key(), algorithms=[settings.JWT_ALGORITHM])
    if claims.get("typ") != "google_link" or not claims.get("google_sub"):
        raise ValueError("Not a Google link token")
    return claims



# ── Sign-in record ───────────────────────────────────────────────────────────

def issue_session(db: Session, user: User, method: str, request=None) -> str:
    """Issue an access token and record the sign-in in the audit log, so the
    user's activity log can show when and how their account was accessed
    (and "Not you? Sign out everywhere" has something to point at)."""
    from app.models.models import AdminInvite, AuditLog

    # An admin invited this number before it had an account (Admin Users).
    invite = db.query(AdminInvite).filter(AdminInvite.phone_number == user.phone_number).first()
    if invite:
        user.is_platform_admin = True
        user.platform_admin_role = invite.role
        user.platform_admin_since = datetime.utcnow()
        if not user.display_name:
            user.display_name = invite.name
        db.add(AuditLog(actor_id=invite.invited_by, action_type="admin_invite_accepted", target_id=user.id,
                        target_type="user", details=f"role={invite.role}"))
        db.delete(invite)

    parts = [f"method={method}"]
    if request is not None:
        if request.client:
            parts.append(f"ip={request.client.host}")
        agent = (request.headers.get("user-agent") or "")[:160]
        if agent:
            parts.append(f"agent={agent}")
    db.add(AuditLog(actor_id=user.id, action_type="sign_in", target_id=user.id, target_type="user", details="; ".join(parts)))
    db.commit()
    return create_access_token(user.id, user.phone_number, user.session_version or 0)
