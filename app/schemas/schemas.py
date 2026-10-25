from pydantic import BaseModel, Field, field_validator, model_validator
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
    # From a Google sign-in that returned needs_phone: verifying the phone
    # (when Firebase SMS is off) also links that Google account to it.
    google_link_token: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    phone_number: str


class FirebaseAuthRequest(BaseModel):
    id_token: str  # Firebase Authentication ID token (phone or Google sign-in)
    # From a previous Google sign-in that returned needs_phone: links that
    # Google account to the phone this token verifies.
    google_link_token: Optional[str] = None


class GooglePhoneRequest(BaseModel):
    """First Google sign-in when phone numbers can't be verified: the link
    token from /auth/firebase plus the number to record (unverified)."""
    link_token: str
    phone_number: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class AuthExchangeResponse(BaseModel):
    """Either a session, or needs_phone with a short-lived link_token (a
    Google account not yet linked to a phone)."""
    needs_phone: bool = False
    link_token: Optional[str] = None
    email: Optional[str] = None
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user_id: Optional[str] = None
    phone_number: Optional[str] = None


class UserOut(BaseModel):
    id: str
    phone_number: str
    display_name: Optional[str]
    email: Optional[str]
    wallet_address: Optional[str]
    created_at: datetime
    # Work Order 04 C1 — the frontend's AuthContext fetches this after
    # login to know whether to show the Admin surface at all.
    is_platform_admin: bool = False
    google_linked: bool = False
    phone_verified: bool = True

    model_config = {"from_attributes": True}


# ─── Events ───────────────────────────────────────────────────────────────────

# The Organiser Console's status vocabulary <-> EventStatus values.
EVENT_STATUS_FROM_UI = {
    "draft": "draft", "live": "published", "paused": "paused",
    "sold_out": "sold_out", "cancelled": "cancelled",
}
EVENT_STATUS_TO_UI = {v: k for k, v in EVENT_STATUS_FROM_UI.items()} | {"completed": "completed"}


class TierIn(BaseModel):
    """One ticket category from the Event Management form. `id` is present
    when editing an existing tier. Field names follow the form (camelCase
    where the form uses it); extra keys the form carries along are ignored."""
    id: Optional[str] = None
    name: str = ""
    description: Optional[str] = None
    price: float = 0
    capacity: int = 0
    perOrderMax: Optional[int] = None
    visibility: str = "public"
    salesStart: Optional[datetime] = None
    salesEnd: Optional[datetime] = None

    @field_validator("perOrderMax", "salesStart", "salesEnd", mode="before")
    @classmethod
    def blank_is_none(cls, v):
        return None if v in ("", None) else v

    @field_validator("visibility")
    @classmethod
    def valid_visibility(cls, v):
        if v not in ("public", "hidden", "password"):
            raise ValueError("visibility must be public, hidden or password")
        return v


class GateIn(BaseModel):
    id: Optional[str] = None
    name: str


class EventDetailsIn(BaseModel):
    """Fields shared by create and update, every one optional here; the
    route decides what a given status requires."""
    title: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    description_html: Optional[str] = None
    image_data_url: Optional[str] = None
    venue: Optional[str] = None
    event_date: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    artists: Optional[list[str]] = None
    status: Optional[str] = None  # UI vocabulary: draft|live|paused|sold_out|cancelled
    total_capacity: Optional[int] = None
    max_resale_multiplier: Optional[float] = None
    resale_royalty_percent: Optional[float] = None
    resale_enabled: Optional[bool] = None
    resale_window_open_days: Optional[int] = None
    resale_window_close_hours: Optional[int] = None
    tiers: Optional[list[TierIn]] = None
    gates: Optional[list[GateIn]] = None

    @field_validator("event_date", "ends_at", "total_capacity", mode="before")
    @classmethod
    def blank_is_none(cls, v):
        return None if v in ("", None) else v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in EVENT_STATUS_FROM_UI:
            raise ValueError(f"status must be one of {', '.join(EVENT_STATUS_FROM_UI)}")
        return v


class EventCreate(EventDetailsIn):
    # Required (Work Order 04 B3) — every event belongs to an organisation.
    # The caller must be an OWNER member of it (app/core/authz.py).
    organization_id: str
    title: str
    # Defaults to the creating user's own number.
    organizer_phone: Optional[str] = None
    # The original flat single-tier payload — still accepted; ignored when
    # `tiers` is given.
    ticket_price_kes: Optional[float] = None
    max_resale_multiplier: float = 1.2
    resale_royalty_percent: float = 10.0

    @field_validator("organizer_phone")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v) if v else v

    @field_validator("ticket_price_kes")
    @classmethod
    def positive_price(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Ticket price must be positive")
        return v

    @field_validator("total_capacity")
    @classmethod
    def positive_capacity(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Capacity must be positive")
        return v


class EventUpdate(EventDetailsIn):
    pass


class TierOut(BaseModel):
    """
    The frontend (built against the mock backend) expects every event to
    carry a `tiers[]` array — EventDetail.jsx and Checkout.jsx both call
    `event.tiers.find(...)` directly and crash if it's undefined. The real
    backend already creates one EventTier row per event (see events.py);
    this was just never exposed through the API. Field names here match
    what the frontend reads (name/price), not the ORM's own column names
    (tier_name/price_kes) — aliased below rather than renaming either side.
    """
    id: str
    name: str = Field(validation_alias="tier_name")
    price: float = Field(validation_alias="price_kes")
    tickets_remaining: int

    model_config = {"from_attributes": True, "populate_by_name": True}


class EventOut(BaseModel):
    id: str
    title: str
    category: Optional[str] = None
    # Path to the cover image (GET /events/{id}/image), never the bytes.
    image_url: Optional[str] = None
    description: Optional[str]
    description_html: Optional[str] = None
    artists: Optional[list[str]] = None
    ends_at: Optional[datetime] = None
    availability: str = "available"
    venue: str
    event_date: datetime
    ticket_price_kes: float
    total_capacity: int
    tickets_sold: int
    tickets_remaining: int
    max_resale_price_kes: float
    resale_royalty_percent: float
    resale_ceiling_multiplier: float = 1.2
    resale_enabled: bool = True
    map_url: Optional[str] = None
    contract_address: Optional[str]
    status: str
    # pending when the event is waiting in Event Approvals (status stays draft).
    review_state: Optional[str] = None
    created_at: datetime
    # Hidden/password tiers are the organiser's to hand out, never listed.
    tiers: list[TierOut] = Field(default=[], validation_alias="visible_tiers")

    model_config = {"from_attributes": True, "populate_by_name": True}


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
    quantity: int = 1

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("quantity")
    @classmethod
    def sane_quantity(cls, v):
        if v < 1:
            raise ValueError("Quantity must be at least 1")
        if v > 10:
            raise ValueError("Maximum 10 tickets per purchase")
        return v


class PurchaseResponse(BaseModel):
    ticket_id: str  # the first/primary ticket — kept for backward compatibility
    ticket_ids: list[str]  # every ticket this purchase created (length == quantity)
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
    failure_reason: Optional[str] = None
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

# ─── Resale (Work Order 02) ───────────────────────────────────────────────────
# Response shapes are built as plain dicts in app/api/routes/resale.py rather
# than modeled here — the frontend's mock API mixes snake_case (most fields)
# and camelCase (the dashboard/wallet summary endpoints) inconsistently, and
# matching it exactly (per Work Order 02: "do not redesign the Seller Portal")
# matters more than a uniform schema would. Only request bodies are modeled
# below, where real validation is worth having.

class ResaleListingCreate(BaseModel):
    ticket_id: str
    price_kes: float

    @field_validator("price_kes")
    @classmethod
    def positive_price(cls, v):
        if v <= 0:
            raise ValueError("Price must be positive")
        return v


class ResaleRepriceRequest(BaseModel):
    price_kes: float

    @field_validator("price_kes")
    @classmethod
    def positive_price(cls, v):
        if v <= 0:
            raise ValueError("Price must be positive")
        return v


class ResaleBuyRequest(BaseModel):
    phone_number: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)


class ResaleWithdrawRequest(BaseModel):
    amount_kes: float
    phone_number: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("amount_kes")
    @classmethod
    def positive_amount(cls, v):
        if v <= 0:
            raise ValueError("Amount must be positive")
        return v


# ─── Organisations (Work Order 04 B2) ─────────────────────────────────────────

class OrganisationCreate(BaseModel):
    business_name: str


class OrganisationOut(BaseModel):
    id: str
    business_name: str
    verification_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MyOrganisationOut(OrganisationOut):
    """GET /organisations/mine — adds the caller's own role in this
    organisation (Work Order 04 C1), which the frontend's AuthContext
    needs to decide what the Organiser surface should let this user do."""
    role: str


class MemberInvite(BaseModel):
    phone_number: str
    role: str  # "owner" | "staff"
    # Saved as the invitee's display name if they don't have one yet.
    name: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("owner", "staff"):
            raise ValueError("role must be 'owner' or 'staff'")
        return v


class MemberRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("owner", "staff"):
            raise ValueError("role must be 'owner' or 'staff'")
        return v


class MemberOut(BaseModel):
    id: str
    account_id: str
    phone_number: str
    display_name: Optional[str] = None
    role: str
    created_at: datetime


# ─── Scanner devices (Work Order 04 B4) ───────────────────────────────────────

class ScannerRegisterRequest(BaseModel):
    event_id: str
    gate_name: str
    label: Optional[str] = None  # "Gate A — Scanner 1"


class ScannerRegisterResponse(BaseModel):
    scanner_id: str
    enrollment_code: str
    expires_at: datetime


class ScannerEnrollRequest(BaseModel):
    enrollment_code: str
    device_id: str


class ScannerEnrollResponse(BaseModel):
    device_token: str
    scanner_id: str
    event_id: str
    event_title: str
    gate_name: str


# ─── Scan reconciliation (Work Order 05 B5) ───────────────────────────────────

class ScanUploadItem(BaseModel):
    ticket_id: str
    granted: bool
    reason_code: str  # one of validate.js's REASON codes
    scanned_at: datetime  # the device's own local time of the scan


class ScanUploadRequest(BaseModel):
    scans: list[ScanUploadItem]


class ScanUploadResultItem(BaseModel):
    ticket_id: str
    status: str  # "recorded" | "duplicate" | "conflict"
    detail: Optional[str] = None


class TicketSeedResponse(BaseModel):
    """Returned to the authenticated ticket app — contains the TOTP secret."""
    ticket_id: str
    totp_secret: str
    totp_issuer: str
    event_title: str
    event_date: str
    venue: str
    # Current rotating payload as text — same string the QR image encodes.
    # Lets the MVP's manual-entry gate scanner work without a camera/QR
    # decoder; the image endpoint (qr.png) remains the primary source once
    # camera scanning is added.
    qr_payload: str


# ─── Organiser Console (organisation-scoped) ──────────────────────────────────

class ComplimentaryTicketRequest(BaseModel):
    event_id: str
    tier_id: Optional[str] = None
    recipient_name: str
    recipient_phone: str
    note: Optional[str] = None

    @field_validator("recipient_phone")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("recipient_name")
    @classmethod
    def name_required(cls, v):
        if not v.strip():
            raise ValueError("Recipient name is required")
        return v.strip()


class ManualOverrideRequest(BaseModel):
    ticket_id: str
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v):
        if not v.strip():
            raise ValueError("A reason is required for a manual override")
        return v.strip()


class OrganisationProfileUpdate(BaseModel):
    businessName: Optional[str] = None
    kraPin: Optional[str] = None
    contactEmail: Optional[str] = None
    contactPhone: Optional[str] = None

    @field_validator("contactPhone")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v) if v else None


class PayoutDetailsUpdate(BaseModel):
    payoutMethod: str
    payoutDestination: str

    @field_validator("payoutMethod")
    @classmethod
    def valid_method(cls, v):
        if v not in ("mpesa", "bank"):
            raise ValueError("payoutMethod must be 'mpesa' or 'bank'")
        return v

    @field_validator("payoutDestination")
    @classmethod
    def destination_required(cls, v):
        if not v.strip():
            raise ValueError("A payout destination is required")
        return v.strip()


class ExportRequest(BaseModel):
    type: str  # ticket_sales | attendance | royalty_ledger | payouts
    format: str = "csv"


# ─── Platform Admin ──────────────────────────────────────────────────────────

class OrganiserReviewRequest(BaseModel):
    decision: str
    reason: Optional[str] = None

    @field_validator("decision")
    @classmethod
    def valid_decision(cls, v):
        if v not in ("verified", "rejected"):
            raise ValueError("decision must be verified or rejected")
        return v


class AdminReasonRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class FeeConfigUpdate(BaseModel):
    platformFeePercent: float = Field(ge=0, le=30)
    scanningFeeKes: float = Field(ge=0, le=1000)
    minPayoutKes: float = Field(ge=1, le=100_000)
    sellerEscrowDays: int = Field(ge=0, le=60)
    organiserEscrowDays: int = Field(ge=0, le=60)


class BroadcastCreate(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    channels: list[str] = Field(min_length=1)
    audience: str
    scheduledFor: Optional[datetime] = None

    @field_validator("scheduledFor", mode="before")
    @classmethod
    def blank_is_none(cls, v):
        return None if v in ("", None) else v

    @field_validator("audience")
    @classmethod
    def valid_audience(cls, v):
        if v not in ("all", "attendees", "organisers", "gate_staff"):
            raise ValueError("audience must be all, attendees, organisers or gate_staff")
        return v


class AdminInviteRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str
    role: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v):
        return normalize_kenyan_phone(v)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("super_admin", "support", "finance", "compliance"):
            raise ValueError("role must be super_admin, support, finance or compliance")
        return v


class FeatureFlagRollout(BaseModel):
    rollout_percent: int = Field(ge=0, le=100)
