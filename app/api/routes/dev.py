"""
Development-only endpoints. Mounted directly on the app (app/main.py),
deliberately NOT under /api/v1 — these aren't part of the versioned public
API surface at all.

GET /dev/otp-inbox is a complete authentication bypass if it is ever
reachable in production: it lets anyone read any phone number's current
OTP. It fails closed at two levels (Work Order 04 A5):

  1. This route itself returns 404 — not 403 — when APP_ENV isn't exactly
     "development". 404 rather than 403 so the route doesn't even
     advertise that it exists to anything probing it.
  2. Settings' own _otp_inbox_requires_development validator
     (app/core/config.py) refuses to let the app start at all if
     OTP_DELIVERY_CHANNEL=inbox while APP_ENV isn't "development" — so a
     misconfigured deployment can't reach this code path regardless of
     what this route checks at request time.

"APP_ENV unset means not development" is guaranteed one layer up:
Settings.APP_ENV (app/core/config.py) has no default at all, so a
deployment that never sets it fails to construct Settings — and therefore
fails to start — before this route is ever reachable. This route reads
get_settings() fresh on every request (not a module-level constant
captured at import time) so there is exactly one place this check can go
stale.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.models import Notification
from app.services.auth_service import peek_otp

router = APIRouter(prefix="/dev", tags=["Development"])


def _is_development() -> bool:
    return get_settings().APP_ENV == "development"


@router.get("/otp-inbox")
def otp_inbox(db: Session = Depends(get_db)):
    if not _is_development():
        raise HTTPException(status_code=404, detail="Not found")

    notifications = (
        db.query(Notification)
        .filter(Notification.notification_type == "otp", Notification.channel == "inbox")
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )

    entries = []
    for n in notifications:
        phone = n.recipient.phone_number if n.recipient else None
        entries.append({
            "phone_number": phone,
            # None here means the code has already been consumed or expired
            # — Redis (the single source of truth for the live code) no
            # longer has it, which is correct behaviour, not a bug.
            "otp": peek_otp(phone) if phone else None,
            "sent_at": n.created_at.isoformat(),
        })
    return entries
