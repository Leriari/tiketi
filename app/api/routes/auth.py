from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.schemas import PhoneOTPRequest, OTPVerifyRequest, TokenResponse, UserOut
from app.services import auth_service
from app.core.dependencies import get_current_user
from app.models.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/request-otp", summary="Send OTP to phone number")
async def request_otp(body: PhoneOTPRequest, db: Session = Depends(get_db)):
    """
    Step 1: User submits their phone number.
    Backend sends a 6-digit OTP via SMS.
    """
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
def verify_otp(body: OTPVerifyRequest, db: Session = Depends(get_db)):
    """
    Step 2: User submits OTP.
    Backend validates it and returns a JWT access token.
    Creates the user account if this is their first login.
    """
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
