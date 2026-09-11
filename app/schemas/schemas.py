from pydantic import BaseModel, field_validator, model_validator
from datetime import datetime
from typing import Optional
import phonenumbers


# ─── Helpers ──────────────────────────────────────────────────────────────────

def normalize_kenyan_phone(phone: str) -> str:
    """Convert 07XXXXXXXX or +2547XXXXXXXX to 2547XXXXXXXX (Daraja format)."""
    try:
        parsed = phonenumbers.parse(phone, "KE")
        if not phonenumbers.is_valid_number(parsed):
            raise ValueError("Invalid Kenyan phone number")
        # Daraja expects format: 254XXXXXXXXX (no +)
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164).lstrip("+")
    except phonenumbers.NumberParseException:
        raise ValueError(f"Cannot parse phone number: {phone}")


# ─── Auth / Users ─────────────────────────────────────────────────────────────

class PhoneOTPRequest(BaseModel):
    phone_number: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class OTPVerifyRequest(BaseModel):
    phone_number: str
    otp_code: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    phone_number: str


class UserOut(BaseModel):
    id: str
    phone_number: str
    display_name: Optional[str]
    email: Optional[str]
    wallet_address: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Events ───────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    venue: str
    event_date: datetime
    organizer_phone: str
    ticket_price_kes: float
    total_capacity: int
    max_resale_multiplier: float = 1.2
    resale_royalty_percent: float = 10.0

    @field_validator("organizer_phone")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("ticket_price_kes")
    @classmethod
    def positive_price(cls, v):
        if v <= 0:
            raise ValueError("Ticket price must be positive")
        return v

    @field_validator("total_capacity")
    @classmethod
    def positive_capacity(cls, v):
        if v <= 0:
            raise ValueError("Capacity must be positive")
        return v


class EventOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    venue: str
    event_date: datetime
    ticket_price_kes: float
    total_capacity: int
    tickets_sold: int
    tickets_remaining: int
    max_resale_price_kes: float
    resale_royalty_percent: float
    contract_address: Optional[str]
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Tickets ──────────────────────────────────────────────────────────────────

class TicketOut(BaseModel):
    id: str
    event_id: str
    owner_id: str
    status: str
    seat_number: Optional[str]
    nft_token_id: Optional[int]
    purchased_at: Optional[datetime]
    created_at: datetime
    # Note: totp_secret is NEVER returned via API — only via the secure ticket app

    model_config = {"from_attributes": True}


# ─── Payments ─────────────────────────────────────────────────────────────────

class PurchaseRequest(BaseModel):
    event_id: str
    phone_number: str  # phone to charge via M-Pesa
    # Optional — omitted requests resolve to the event's only/first tier (Phase 1).
    # Becomes meaningful once events can have multiple tiers (Phase 2).
    tier_id: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class PurchaseResponse(BaseModel):
    ticket_id: str
    payment_id: str
    checkout_request_id: str
    message: str = "STK push sent. Confirm payment on your phone."


class MpesaCallbackBody(BaseModel):
    """Safaricom Daraja sends this to our callback URL on payment result."""
    Body: dict  # Daraja wraps everything in a "Body" key


class PaymentStatusOut(BaseModel):
    id: str = None
    payment_id: str = None  # alias for id
    status: str
    mpesa_receipt_number: Optional[str]
    amount_kes: float
    initiated_at: datetime
    confirmed_at: Optional[datetime]

    model_config = {"from_attributes": True}

    def model_post_init(self, __context):
        # Expose both `id` and `payment_id` pointing to the same value
        if self.id and not self.payment_id:
            object.__setattr__(self, "payment_id", self.id)
        elif self.payment_id and not self.id:
            object.__setattr__(self, "id", self.payment_id)


# ─── TOTP / QR ────────────────────────────────────────────────────────────────

class TicketSeedResponse(BaseModel):
    """Returned to the authenticated ticket app — contains the TOTP secret."""
    ticket_id: str
    totp_secret: str
    totp_issuer: str
    event_title: str
    event_date: str
    venue: str
