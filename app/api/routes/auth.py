from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.schemas import PhoneOTPRequest, OTPVerifyRequest, TokenResponse, UserOut
from app.services import auth_service
from app.core.dependencies import get_current_user
from app.core.rate_limit import enforce_rate_limit, client_ip
from app.models.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])

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


@router.post("/request-otp", summary="Send OTP to phone number")
async def request_otp(body: PhoneOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Step 1: User submits their phone number.
    Backend sends a 6-digit OTP via SMS.
    """
    enforce_rate_limit(f"otp-request:phone:{body.phone_number}", *_OTP_REQUEST_PHONE_LIMIT)
    enforce_rate_limit(f"otp-request:ip:{client_ip(request)}", *_OTP_REQUEST_IP_LIMIT)

    otp = auth_service.generate_otp()
    auth_service.store_otp(body.phone_number, otp)
    await auth_service.send_otp_sms(body.phone_number, otp)

    response = {"message": "OTP sent", "phone_number": body.phone_number}

    # In development, include the OTP in the response for easy testing
    from app.core.config import get_settings
    if get_settings().APP_ENV == "development":
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

    if not auth_service.verify_otp(body.phone_number, body.otp_code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )

    user = auth_service.get_or_create_user(db, body.phone_number)
    token = auth_service.create_access_token(user.id, user.phone_number)

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        phone_number=user.phone_number,
    )


@router.get("/me", response_model=UserOut, summary="Get current user profile")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/login", response_model=TokenResponse, summary="Log in with just a phone number (MVP — no OTP)")
def login(body: PhoneOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Simplified MVP login: no SMS/OTP verification round-trip.
    Creates the account on first login, same as /verify-otp does.

    /request-otp + /verify-otp stay available and untouched for whenever
    real SMS delivery is wired up — this is a deliberately simpler
    replacement for now, not a removal of that flow.
    """
    enforce_rate_limit(f"login:phone:{body.phone_number}", *_LOGIN_PHONE_LIMIT)
    enforce_rate_limit(f"login:ip:{client_ip(request)}", *_LOGIN_IP_LIMIT)

    user = auth_service.get_or_create_user(db, body.phone_number)
    token = auth_service.create_access_token(user.id, user.phone_number)

    return TokenResponse(
        access_token=token,
        user_id=user.id,
        phone_number=user.phone_number,
    )
