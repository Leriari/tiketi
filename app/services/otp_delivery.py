"""
Pluggable OTP delivery (Work Order 04 A5). There is no SMS provider and
there will not be one before submission — rather than treating that as a
broken feature, the delivery channel is an explicit, swappable part of the
architecture, selected by OTP_DELIVERY_CHANNEL:

  console (default): logs the code to the server log. Unchanged behaviour
    from before this module existed.
  inbox: writes a Notification row and logs to console too, so a developer
    tailing logs doesn't lose anything just because the channel changed.
    Readable through the dev-only GET /dev/otp-inbox endpoint
    (app/api/routes/dev.py), which itself fails closed outside development
    regardless of this setting — see that file and Settings'
    _otp_inbox_requires_development validator (app/core/config.py).
  sms: raises NotImplementedError, naming the gateway that would go here.
    This failing loudly is the point — it documents in code that the
    architecture is ready for a real gateway and that none is configured,
    rather than pretending the concept doesn't exist.

This module does not store the OTP code itself in the notifications
table — Redis (app/services/auth_service.py) is already the single source
of truth for "what is this phone's current valid code," with its own TTL
and attempt-limit; duplicating that into a second, un-expiring copy in the
database would be a real regression, not a convenience. The Notification
row is only ever an audit trail of "a code was issued to this user at this
time" — the inbox endpoint cross-references it with auth_service.peek_otp
to show the current code where safe to do so.
"""
import logging
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.models import Notification, NotificationStatus

logger = logging.getLogger(__name__)


def deliver_otp(phone_number: str, otp: str, db: Session) -> None:
    channel = get_settings().OTP_DELIVERY_CHANNEL

    if channel == "console":
        logger.info(f"[DEV] OTP for {phone_number}: {otp}")
        return

    if channel == "inbox":
        from app.services.auth_service import get_or_create_user
        user = get_or_create_user(db, phone_number)
        db.add(Notification(
            recipient_id=user.id,
            notification_type="otp",
            channel="inbox",
            status=NotificationStatus.SENT,
        ))
        db.commit()
        logger.info(f"[DEV INBOX] OTP for {phone_number}: {otp}")
        return

    if channel == "sms":
        raise NotImplementedError(
            "OTP_DELIVERY_CHANNEL=sms but no SMS gateway is configured. "
            "This project never integrates one — set OTP_DELIVERY_CHANNEL "
            "to 'console' or 'inbox' for development, or implement a real "
            "gateway call in app/services/otp_delivery.py for production."
        )

    raise ValueError(f"Unknown OTP_DELIVERY_CHANNEL: {channel!r}")
