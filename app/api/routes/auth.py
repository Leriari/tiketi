from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from jose import JWTError

from app.schemas.schemas import (
    PhoneOTPRequest, OTPVerifyRequest, TokenResponse, UserOut, FirebaseAuthRequest, AuthExchangeResponse,
    GooglePhoneRequest,
    normalize_kenyan_phone,
)
from app.services import auth_service, otp_delivery
from app.core.config import get_settings
from app.core.dependencies import get_current_user
from app.core.rate_limit import enforce_rate_limit, client_ip
from app.models.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()

# Limited by both phone number and client IP (Work Order 04 A3) — per-phone
# alone lets an attacker cycle numbers from one machine; per-IP alone lets a
# distributed attacker hammer one number. The two dimensions deliberately
# have different ceilings: one IP can legitimately represent many phones
# (a venue's shared wifi, several test users in the same CI run), so its
# budget is set well above any single phone's — tripping the IP limit means
# *broad* abuse from one source, not one person retrying a mistyped code.
_OTP_REQUEST_PHONE_LIMIT = (5, 300)
_OTP_REQUEST_IP_LIMIT = (30, 300)
_OTP_VERIFY_PHONE_LIMIT = (10, 300)
_OTP_VERIFY_IP_LIMIT = (50, 300)
_LOGIN_PHONE_LIMIT = (5, 300)
_LOGIN_IP_LIMIT = (40, 300)
_FIREBASE_IP_LIMIT = (30, 300)


@router.post("/request-otp", summary="Send OTP to phone number")
async def request_otp(body: PhoneOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Step 1: User submits their phone number.
    Backend sends a 6-digit OTP via SMS.
    """
    enforce_rate_limit(f"otp-request:phone:{body.phone_number}", *_OTP_REQUEST_PHONE_LIMIT)
    enforce_rate_limit(f"otp-request:ip:{client_ip(request)}", *_OTP_REQUEST_IP_LIMIT)

    demo_code = settings.demo_phone_codes.get(body.phone_number)
    if demo_code:
        # A configured demo number: its fixed code, nothing is sent.
        otp = demo_code
        auth_service.store_otp(body.phone_number, otp)
    elif settings.OTP_DELIVERY_CHANNEL == "disabled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone codes can't be sent on this site. Use Continue with Google instead.",
        )
    else:
        otp = auth_service.generate_otp()
        auth_service.store_otp(body.phone_number, otp)
        otp_delivery.deliver_otp(body.phone_number, otp, db)

    response = {"message": "OTP sent", "phone_number": body.phone_number}

    # In development, include the OTP in the response for easy testing
    if settings.APP_ENV == "development":
        response["dev_otp"] = otp  # NEVER in production!

    return response


@router.post("/verify-otp", response_model=TokenResponse, summary="Verify OTP and get JWT")
def verify_otp(body: OTPVerifyRequest, request: Request, db: Session = Depends(get_db)):
    """
    Step 2: User submits OTP.
    Backend validates it and returns a JWT access token.
    Creates the user account if this is their first login.
    """
    enforce_rate_limit(f"otp-verify:phone:{body.phone_number}", *_OTP_VERIFY_PHONE_LIMIT)
    enforce_rate_limit(f"otp-verify:ip:{client_ip(request)}", *_OTP_VERIFY_IP_LIMIT)

    # Check the link token before the code: verifying the code uses it up,
    # and an expired link shouldn't cost the user their code.
    link = _decode_link(body.google_link_token)

    if not auth_service.verify_otp(body.phone_number, body.otp_code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )

    user = auth_service.get_or_create_user(db, body.phone_number)
    user.phone_verified = True  # a correct code proves the number
    if link:
        _link_google_account(db, user, link["google_sub"], link.get("email"))
    db.commit()
    token = auth_service.issue_session(db, user, "phone code + Google" if link else "phone code", request)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        phone_number=user.phone_number,
    )


def _decode_link(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return auth_service.decode_google_link_token(token)
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your Google sign-in expired. Choose \"Continue with Google\" again.",
        )


def _link_google_account(db: Session, user: User, google_sub: str, email: str | None) -> None:
    """Attach a Google account to a phone-verified user. One Google account
    per user and one user per Google account; the email is saved only if
    the user has none and no one else has it."""
    if user.google_sub == google_sub:
        return
    if user.google_sub:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This phone number is already linked to a different Google account.",
        )
    if db.query(User).filter(User.google_sub == google_sub).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That Google account is already linked to a different phone number.",
        )
    user.google_sub = google_sub
    if email and not user.email and not db.query(User).filter(User.email == email).first():
        user.email = email
    if email and user.email and user.email.lower() == email.lower():
        user.email_verified = True  # Google confirmed this address


def _session(db: Session, user: User, method: str, request: Request) -> AuthExchangeResponse:
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled.")
    return AuthExchangeResponse(
        access_token=auth_service.issue_session(db, user, method, request),
        user_id=user.id,
        phone_number=user.phone_number,
    )


@router.post("/firebase", response_model=AuthExchangeResponse, summary="Exchange a Firebase ID token for a session")
def firebase_sign_in(body: FirebaseAuthRequest, request: Request, db: Session = Depends(get_db)):
    """
    The login screen signs in with Firebase Authentication — a phone number
    (Firebase sends and checks the SMS code) or Google — and sends the
    resulting Firebase ID token here. This backend keeps issuing its own
    session; Firebase only proves who the person is.

    - Phone token: the phone number is verified, so this signs into (or
      creates) that phone's account. If google_link_token is present, the
      Google account from the step before is linked to it as well.
    - Google token: signs straight in if that Google account is already
      linked. Otherwise returns needs_phone + a link_token (10 minutes): the
      login screen then verifies a phone with Firebase and calls this again
      with the phone token and the link_token.
    """
    if not settings.FIREBASE_CONFIGURED:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Firebase sign-in isn't set up on this server.")
    enforce_rate_limit(f"firebase:ip:{client_ip(request)}", *_FIREBASE_IP_LIMIT)

    # Check the link token first, so an expired one fails before anything changes.
    link = _decode_link(body.google_link_token)

    try:
        claims = auth_service.verify_firebase_token(body.id_token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign-in failed. Please try again.")

    identities = (claims.get("firebase") or {}).get("identities") or {}
    google_ids = identities.get("google.com") or []
    google_sub = google_ids[0] if google_ids else None
    email = claims.get("email") if claims.get("email_verified") else None

    phone_claim = claims.get("phone_number")
    if phone_claim:
        try:
            phone = normalize_kenyan_phone(phone_claim)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ChainTix currently supports Kenyan phone numbers only.")
        user = auth_service.get_or_create_user(db, phone)
        if link:
            _link_google_account(db, user, link["google_sub"], link.get("email"))
        if google_sub:  # Firebase account that already has Google attached
            _link_google_account(db, user, google_sub, email)
        db.commit()
        return _session(db, user, "phone (SMS) + Google" if link else "phone (SMS)", request)

    if google_sub:
        user = db.query(User).filter(User.google_sub == google_sub).first()
        if user:
            return _session(db, user, "Google", request)
        return AuthExchangeResponse(
            needs_phone=True,
            link_token=auth_service.create_google_link_token(google_sub, email),
            email=email,
        )

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sign in with a phone number or Google.")


@router.post("/google-phone", response_model=AuthExchangeResponse, summary="Finish a first Google sign-in without SMS")
def google_phone(body: GooglePhoneRequest, request: Request, db: Session = Depends(get_db)):
    """
    Only when GOOGLE_PHONE_CONFIRMATION=unverified (a deployment with no SMS):
    a first-time Google user gives their phone number, which is recorded
    unverified — their default M-Pesa number, not proof of identity — and
    their account is created with Google linked.
    """
    if settings.GOOGLE_PHONE_CONFIRMATION != "unverified":
        raise HTTPException(status_code=404, detail="Not found")
    enforce_rate_limit(f"google-phone:ip:{client_ip(request)}", *_FIREBASE_IP_LIMIT)
    link = _decode_link(body.link_token)

    if db.query(User).filter(User.phone_number == body.phone_number).first():
        # Never attach an unverified claim to someone else's account.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That number already belongs to an account. Use a different number, or sign in with that number's code.",
        )
    if db.query(User).filter(User.google_sub == link["google_sub"]).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This Google account is already set up. Continue with Google again.")

    user = User(phone_number=body.phone_number, phone_verified=False)
    db.add(user)
    db.flush()
    _link_google_account(db, user, link["google_sub"], link.get("email"))
    db.commit()
    return _session(db, user, "Google", request)


@router.get("/me", response_model=UserOut, summary="Get current user profile")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post(
    "/login",
    response_model=TokenResponse,
    include_in_schema=settings.APP_ENV == "development",
    summary="DEV/TEST ONLY — log in with just a phone number, no OTP",
)
def login(body: PhoneOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Work Order 05 A1 — this used to be the live app's actual login path,
    which meant every role check built in Work Order 04 rested on nothing:
    a phone number with no proof of ownership was enough to become any
    user, including a platform admin. The real login is now
    request-otp/verify-otp (see Login.jsx). This endpoint survives only
    because the entire backend test suite uses it for fast auth setup
    (no OTP round-trip needed in a test) — gated the same way dev-confirm
    is, not deleted, since something still depends on it. Hidden from the
    OpenAPI docs and hard-blocked outside development regardless of that,
    since include_in_schema only hides a route, it doesn't disable it.
    """
    if settings.APP_ENV != "development":
        raise HTTPException(status_code=404, detail="Not found")

    enforce_rate_limit(f"login:phone:{body.phone_number}", *_LOGIN_PHONE_LIMIT)
    enforce_rate_limit(f"login:ip:{client_ip(request)}", *_LOGIN_IP_LIMIT)

    user = db.query(User).filter(User.phone_number == body.phone_number).first()
    if not user:
        # No code was checked, so the number isn't verified.
        user = User(phone_number=body.phone_number, phone_verified=False)
        db.add(user)
        db.commit()
    token = auth_service.issue_session(db, user, "dev login", request)

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        phone_number=user.phone_number,
    )
