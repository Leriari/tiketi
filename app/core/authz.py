"""
Authorisation (Work Order 04 B3). One reusable set of primitives, applied
consistently, rather than ad-hoc `if user.id == ...` checks scattered
through route handlers — that's how authorisation bugs survive review.

Two kinds of identity now exist:
  - A user JWT (app.core.dependencies.get_current_user), scoped to zero or
    more organisations via OrganizerMember rows, checked here with
    require_org_role / require_event_org_role.
  - A scanner device token (get_current_scanner, below), scoped to exactly
    one event+gate, issued by /gate/enroll (B4). Never a user, never
    reusable across events.

PLATFORM_ADMIN (require_platform_admin) is the one global role — a flag on
User, not a relationship to anything.
"""
import hashlib
import secrets
from enum import IntEnum

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.models.models import User, Event, OrganizerMember, OrganizerRole, GateScanner, GateScannerStatus


class RoleLevel(IntEnum):
    STAFF = 1
    OWNER = 2


_ROLE_LEVEL = {OrganizerRole.STAFF: RoleLevel.STAFF, OrganizerRole.OWNER: RoleLevel.OWNER}


def hash_token(raw_token: str) -> str:
    """SHA-256 of a long, random, high-entropy token — this is not a
    password (no per-user salt/slow-hash needed, same reasoning as hashing
    an API key or session token): the token's own entropy is the defense."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def check_org_role(db: Session, user_id: str, organization_id: str, minimum_role: OrganizerRole) -> OrganizerMember:
    """
    The one shared primitive every authorisation check in this module
    reduces to. Exported (not module-private) because not every call site
    can express "organisation id" as a path parameter FastAPI can inject
    into a Depends — event creation takes it from the request body instead
    (app/api/routes/events.py) and calls this directly, using the exact
    same check as the path-based dependencies below rather than a
    second, ad-hoc one.
    """
    minimum_level = _ROLE_LEVEL[minimum_role]
    member = (
        db.query(OrganizerMember)
        .filter(OrganizerMember.organizer_id == organization_id, OrganizerMember.account_id == user_id)
        .first()
    )
    if not member or _ROLE_LEVEL[member.role] < minimum_level:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised for this organisation")
    return member


def require_org_role(minimum_role: OrganizerRole):
    """
    Dependency factory for routes shaped /organisations/{organization_id}/...
    — resolves the organisation directly from the path.
    """

    def _dep(
        organization_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> OrganizerMember:
        return check_org_role(db, current_user.id, organization_id, minimum_role)

    return _dep


def require_event_org_role(minimum_role: OrganizerRole):
    """
    Dependency factory for routes shaped /.../{event_id}/... — resolves the
    event, then its owning organisation, then checks membership. 404s if
    the event doesn't exist (not an authorisation question); 403 if the
    event has no organisation at all (an event created before Work Order 04,
    or one somehow left unowned — "a user with no organisation cannot reach
    any organiser endpoint at all" applies here too: there is no owner to
    be a member of) or the caller isn't a sufficient member of the one it
    has.
    """
    def _dep(
        event_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> Event:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if not event.organizer_id:
            raise HTTPException(status_code=403, detail="This event has no organisation and cannot be managed")
        check_org_role(db, current_user.id, event.organizer_id, minimum_role)
        return event

    return _dep


def require_platform_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin only")
    return current_user


# ─── Scanner device-token identity (B4) ────────────────────────────────────

_device_bearer = HTTPBearer()


def get_current_scanner(
    credentials: HTTPAuthorizationCredentials = Depends(_device_bearer),
    db: Session = Depends(get_db),
) -> GateScanner:
    """
    Authenticates a scanning device by its long-lived device token — never
    a user JWT. A steward at a gate shouldn't need to be a user account,
    and a phone at a gate shouldn't carry credentials that work anywhere
    else. Revoking a device (status -> INACTIVE) invalidates its token
    immediately, since this check requires ACTIVE on every request.
    """
    token_hash = hash_token(credentials.credentials)
    scanner = (
        db.query(GateScanner)
        .filter(GateScanner.device_token_hash == token_hash, GateScanner.status == GateScannerStatus.ACTIVE)
        .first()
    )
    if not scanner:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked device token")
    return scanner
