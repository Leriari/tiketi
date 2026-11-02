import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime,
    ForeignKey, Enum as SAEnum, Text, JSON, LargeBinary
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import false as sa_false, true as sa_true
from app.db.session import Base
import enum

# NOTE ON SCOPE (Phase 1 — schema alignment to the ChainTix report, §4.4.2 / Figure 4.6):
# This module now mirrors the report's 14-table design (accounts→User, organizers,
# organizer_members, events, event_tiers, tickets, payments, barcodes, price_caps,
# transfers, gate_scanners, attendances, audit_logs, notifications). User, Event,
# EventTier, Ticket, Payment, Barcode, and (as of Work Order 02) Transfer are
# written to by routes — Organizer, OrganizerMember, PriceCap, GateScanner,
# Attendance, AuditLog, and Notification remain schema-complete but unwired.
# See the ChainTix report memory / project plan for the full rationale behind
# each entity.
#
# Known deviation from the report: money fields stay Float (matching the existing
# Phase-1 codebase convention) rather than Integer KES as the report recommends —
# flagged for a deliberate follow-up rather than changed silently here.


# ─── Enums ────────────────────────────────────────────────────────────────────

class TicketStatus(str, enum.Enum):
    PENDING_PAYMENT = "pending_payment"   # awaiting M-Pesa confirmation
    ACTIVE           = "active"           # valid, unused
    USED             = "used"             # scanned at gate
    CANCELLED        = "cancelled"
    RESALE           = "resale"           # listed for secondary market


class PaymentStatus(str, enum.Enum):
    INITIATED = "initiated"   # STK push sent
    SUCCESS   = "success"     # M-Pesa callback confirmed
    FAILED    = "failed"
    TIMEOUT   = "timeout"


class OrganizerVerificationStatus(str, enum.Enum):
    PENDING  = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class OrganizerRole(str, enum.Enum):
    """
    The two organisation-scoped roles (Work Order 04 B1). PLATFORM_ADMIN
    and SCANNER are deliberately not values here: PLATFORM_ADMIN is the one
    genuinely global role (User.is_platform_admin, below) rather than a
    relationship to any one organisation, and SCANNER is a device identity
    (GateScanner + its device token, B4), not a user-role grant at all.
    ATTENDEE is simply the absence of any OrganizerMember row — every user
    is one by default, so it has no enum value either.
    """
    OWNER = "owner"  # ORGANISER_OWNER — everything for this organisation and its events
    STAFF = "staff"  # ORGANISER_STAFF — view and scan, not create or withdraw


class EventStatus(str, enum.Enum):
    DRAFT      = "draft"
    PUBLISHED  = "published"   # the Organiser Console calls this "live"
    PAUSED     = "paused"      # organiser-paused: visible to nobody, not buyable
    SOLD_OUT   = "sold_out"    # organiser-marked sold out: listed, not buyable
    CANCELLED  = "cancelled"
    COMPLETED  = "completed"


class TierStatus(str, enum.Enum):
    ACTIVE    = "active"
    SOLD_OUT  = "sold_out"
    CLOSED    = "closed"


class BarcodeStatus(str, enum.Enum):
    ACTIVE   = "active"
    REVOKED  = "revoked"
    EXPIRED  = "expired"


class PriceCapChangeType(str, enum.Enum):
    INITIAL   = "initial"
    ADJUSTED  = "adjusted"


class TransferType(str, enum.Enum):
    RESALE  = "resale"
    GIFT    = "gift"


class TransferStatus(str, enum.Enum):
    LISTED             = "listed"              # on-chain listForResale succeeded, buyable
    PAUSED              = "paused"              # seller-hidden, not buyable; reprice relists it
    PENDING_PAYMENT     = "pending_payment"     # a buyer's STK push is in flight
    PAID                = "paid"                # M-Pesa confirmed; on-chain settlement queued
    COMPLETED           = "completed"           # settleCustodialResale succeeded, ownership moved
    CANCELLED           = "cancelled"
    EXPIRED             = "expired"
    SETTLEMENT_FAILED   = "settlement_failed"   # paid, but the on-chain settlement tx failed — retryable


class GateScannerStatus(str, enum.Enum):
    ACTIVE    = "active"
    INACTIVE  = "inactive"


class AttendanceStatus(str, enum.Enum):
    ADMITTED  = "admitted"
    DENIED    = "denied"


class NotificationStatus(str, enum.Enum):
    PENDING  = "pending"
    SENT     = "sent"
    FAILED   = "failed"


class WalletTransactionType(str, enum.Enum):
    SALE        = "sale"
    WITHDRAWAL  = "withdrawal"


class WalletTransactionStatus(str, enum.Enum):
    SUCCESS  = "success"
    PENDING  = "pending"
    FAILED   = "failed"


class PayoutStatus(str, enum.Enum):
    PENDING_APPROVAL = "pending_approval"  # waiting for a finance admin
    PROCESSING       = "processing"        # sent to Safaricom, waiting for its result
    PAID             = "paid"
    FAILED           = "failed"            # Safaricom refused it; the money is back in the balance
    REJECTED         = "rejected"          # an admin refused it; the money is back in the balance


# ─── Models ───────────────────────────────────────────────────────────────────

class User(Base):
    """Maps to the report's "accounts" entity."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number: Mapped[str] = mapped_column(String(15), unique=True, index=True, nullable=False)
    # False only for a Google user whose number was recorded without a code
    # (GOOGLE_PHONE_CONFIRMATION=unverified) — then it's just their default
    # M-Pesa number, never proof of who they are. A later phone-code sign-in
    # verifies it.
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true())
    # Phone is the identity — no password needed (OTP-based auth)
    display_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    # True when the address came from Google (which verifies it); a typed-in
    # address stays false. Receipts go to either.
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    # Google account ("sub" claim) linked to this user, if they've used
    # "Continue with Google". Every account still has a verified phone —
    # Google sign-in links to one, it never replaces it.
    google_sub: Mapped[str | None] = mapped_column(String(255), index=True, unique=True)
    # Bumped by "sign out everywhere": every access token carries the
    # version it was issued under, and older ones stop working.
    session_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Custodial wallet address — assigned when NFT minting is enabled (Phase 3 of the roadmap)
    wallet_address: Mapped[str | None] = mapped_column(String(42))
    # Self-custody address a user can optionally claim tickets out to (report: "claimTicket()")
    external_wallet_address: Mapped[str | None] = mapped_column(String(42))
    # Convenience flag only (Work Order 04 B1) — "does this user belong to
    # any organisation at all," kept in sync whenever an OrganizerMember row
    # is created for them (app/api/routes/organisations.py). NEVER read by
    # any authorisation check — real permission decisions always go through
    # OrganizerMember.role for a *specific* organisation (app/core/authz.py),
    # since a flat boolean can't express "owner here, staff there."
    is_organizer: Mapped[bool] = mapped_column(Boolean, default=False)
    # The one genuinely global role (Work Order 04 B1) — every other role is
    # a relationship to a specific organisation (OrganizerMember.role) or a
    # device identity (GateScanner's device token), not a flag on User.
    # Set only by scripts/promote_platform_admin.py (run manually against the
    # database) or by an existing super admin through Admin Users (audited) —
    # see B5: there must be no code path that lets a user grant it to
    # themselves.
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Which admin pages this admin may change (app/api/routes/admin.py):
    # super_admin | support | finance | compliance. Null on an admin means
    # super_admin (admins promoted before roles existed).
    platform_admin_role: Mapped[str | None] = mapped_column(String(20))
    platform_admin_since: Mapped[datetime | None] = mapped_column(DateTime)

    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="owner")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="user")

    @property
    def google_linked(self) -> bool:
        return bool(self.google_sub)


class Organizer(Base):
    """An event-organizing business. Created PENDING by
    app/api/routes/organisations.py; a platform admin verifies or rejects
    it, and can suspend it (app/api/routes/admin.py)."""
    __tablename__ = "organizers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kra_pin: Mapped[str | None] = mapped_column(String(20))
    verification_status: Mapped[OrganizerVerificationStatus] = mapped_column(
        SAEnum(OrganizerVerificationStatus), default=OrganizerVerificationStatus.PENDING
    )
    mpesa_paybill: Mapped[str | None] = mapped_column(String(20))
    royalty_wallet_address: Mapped[str | None] = mapped_column(String(42))
    # Organiser Console profile/payout settings. Where a payout request
    # (Payout) is sent: an M-Pesa number (B2C), or a paybill plus account
    # number, or a till (B2B). A bank is paid through its paybill. "bank" is
    # a legacy value from before payouts existed: it has no paybill, so it
    # must be updated before the organisation can be paid.
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_phone: Mapped[str | None] = mapped_column(String(15))
    payout_method: Mapped[str | None] = mapped_column(String(20))  # "mpesa" | "paybill" | "till"
    payout_destination: Mapped[str | None] = mapped_column(String(50))
    payout_account: Mapped[str | None] = mapped_column(String(20))  # paybill account number
    payout_label: Mapped[str | None] = mapped_column(String(100))   # e.g. "Equity Bank"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    # Admin review. Suspension is separate from verification_status so that
    # reinstating returns the organisation to whatever it was before.
    review_reason: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime)
    suspended_reason: Mapped[str | None] = mapped_column(Text)

    @property
    def admin_status(self) -> str:
        """pending | verified | rejected | suspended — the Admin console's view."""
        return "suspended" if self.suspended_at else self.verification_status.value


class OrganizerMember(Base):
    """Links a User account to an Organizer with a role (OWNER/STAFF). Wired via
    app/api/routes/organisations.py and enforced by app/core/authz.py's
    require_org_role/require_event_org_role (Work Order 04 B2/B3)."""
    __tablename__ = "organizer_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organizer_id: Mapped[str] = mapped_column(ForeignKey("organizers.id"), nullable=False)
    account_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    role: Mapped[OrganizerRole] = mapped_column(SAEnum(OrganizerRole), default=OrganizerRole.STAFF)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    organizer: Mapped["Organizer"] = relationship("Organizer")
    user: Mapped["User"] = relationship("User")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Nullable until Phase 2 builds real organizer registration/auth — organizer_phone
    # remains the practical contact field for now.
    organizer_id: Mapped[str | None] = mapped_column(ForeignKey("organizers.id"))
    # The user account that created this event — the only honest signal of
    # "who owns this event" that exists today (Organizer/OrganizerMember are
    # unwired). Nullable because events created before this column existed
    # have no creator on record; they are simply not gate-manageable by
    # anyone until recreated (Work Order 03).
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    venue: Mapped[str] = mapped_column(String(255), nullable=False)
    event_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    organizer_phone: Mapped[str] = mapped_column(String(15), nullable=False)

    # Venue-wide totals (an EventTier tracks its own capacity/tickets_sold separately —
    # this mirrors the report's ER diagram, which keeps both levels)
    total_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    tickets_sold: Mapped[int] = mapped_column(Integer, default=0)

    # NFT contract address once deployed (Phase 3 of the roadmap)
    contract_address: Mapped[str | None] = mapped_column(String(42))

    status: Mapped[EventStatus] = mapped_column(SAEnum(EventStatus), default=EventStatus.PUBLISHED)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Organiser Console event details (Event Management form).
    category: Mapped[str | None] = mapped_column(String(50))
    description_html: Mapped[str | None] = mapped_column(Text)
    # Cover image: the processed bytes (resized, re-encoded WebP — see
    # app/services/event_images.py), served by GET /events/{id}/image.
    # Deferred so listing events never pulls image blobs off disk; only the
    # image endpoint reads it. In the DB rather than object storage to keep
    # deployment to one database — a few hundred KB per event at most.
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    image_mime: Mapped[str | None] = mapped_column(String(30))
    image_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime)
    artists: Mapped[list | None] = mapped_column(JSON)
    # [{"id": "...", "name": "Gate A"}] — the gates an organiser configured.
    # Scanner registration (gate.py) and partitioning key off gate *names*.
    gates: Mapped[list | None] = mapped_column(JSON)
    resale_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    resale_window_open_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    resale_window_close_hours: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    # Event Approvals (app/services/organiser_service.py): null when no
    # review was needed, else pending | approved | rejected. A pending or
    # rejected event stays DRAFT; review_note is the admin's reason.
    review_state: Mapped[str | None] = mapped_column(String(20))
    review_note: Mapped[str | None] = mapped_column(Text)
    submitted_for_review_at: Mapped[datetime | None] = mapped_column(DateTime)

    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="event")
    tiers: Mapped[list["EventTier"]] = relationship(
        "EventTier", back_populates="event", order_by="[EventTier.sort_order, EventTier.created_at]"
    )

    @property
    def tickets_remaining(self) -> int:
        return self.total_capacity - self.tickets_sold

    @property
    def image_url(self) -> str | None:
        """Path to the cover image, versioned by upload time so browsers can
        cache it forever and still pick up a replacement immediately."""
        if not self.image_mime:
            return None
        from app.core.config import get_settings
        version = int(self.image_updated_at.timestamp()) if self.image_updated_at else 0
        return f"{get_settings().API_V1_PREFIX}/events/{self.id}/image?v={version}"

    @property
    def map_url(self) -> str:
        from urllib.parse import quote
        return f"https://www.google.com/maps/search/?api=1&query={quote(self.venue or '')}"

    @property
    def resale_ceiling_multiplier(self) -> float:
        """Resale cap as a multiple of face value (1.2 = 120%)."""
        tier = self.default_tier
        if tier and tier.price_kes:
            return round(tier.resale_ceiling_price_kes / tier.price_kes, 2)
        return 1.2

    @property
    def resale_floor_multiplier(self) -> float:
        """Lowest resale price as a multiple of face value (1.0 = face value)."""
        tier = self.default_tier
        if tier and tier.price_kes:
            return round((tier.resale_floor_price_kes or 0) / tier.price_kes, 2)
        return 1.0

    @property
    def availability(self) -> str:
        """'available' | 'selling_fast' | 'sold_out' — what event cards badge."""
        remaining = self.total_capacity - self.tickets_sold
        if self.status == EventStatus.SOLD_OUT or remaining <= 0:
            return "sold_out"
        if self.total_capacity and remaining / self.total_capacity <= 0.15:
            return "selling_fast"
        return "available"

    @property
    def visible_tiers(self) -> list["EventTier"]:
        """Tiers the public may see and buy — hidden/password tiers are the
        organiser's to hand out, never listed."""
        return [t for t in self.tiers if (t.visibility or "public") == "public"]

    @property
    def default_tier(self) -> "EventTier | None":
        """The tier a purchase without an explicit tier_id resolves to: the
        organiser's first public tier (falls back to the first tier at all)."""
        visible = self.visible_tiers
        if visible:
            return visible[0]
        return self.tiers[0] if self.tiers else None

    # ── Compatibility shims — Phase 1 keeps the flat pricing API surface stable
    # while the underlying storage moves to EventTier, per the report's design. ──

    @property
    def ticket_price_kes(self) -> float:
        """"From" price — the cheapest public tier."""
        visible = self.visible_tiers
        if visible:
            return min(t.price_kes for t in visible)
        return self.default_tier.price_kes if self.default_tier else 0.0

    @property
    def max_resale_price_kes(self) -> float:
        return self.default_tier.resale_ceiling_price_kes if self.default_tier else 0.0

    @property
    def resale_royalty_percent(self) -> float:
        return self.default_tier.organizer_royalty_percent if self.default_tier else 0.0


class EventTier(Base):
    """Per-tier pricing/capacity/resale rules — replaces the old flat Event pricing fields."""
    __tablename__ = "event_tiers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)

    tier_name: Mapped[str] = mapped_column(String(100), default="General")
    price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    tickets_sold: Mapped[int] = mapped_column(Integer, default=0)

    # Anti-scalping bounds (floor defaults to face value; ceiling is the old max_resale_multiplier)
    resale_floor_price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    resale_ceiling_price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    organizer_royalty_percent: Mapped[float] = mapped_column(Float, default=10.0)

    status: Mapped[TierStatus] = mapped_column(SAEnum(TierStatus), default=TierStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Organiser Console tier settings.
    description: Mapped[str | None] = mapped_column(Text)
    per_order_max: Mapped[int | None] = mapped_column(Integer)
    visibility: Mapped[str] = mapped_column(String(20), default="public", server_default="public")
    sales_start: Mapped[datetime | None] = mapped_column(DateTime)
    sales_end: Mapped[datetime | None] = mapped_column(DateTime)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    event: Mapped["Event"] = relationship("Event", back_populates="tiers")
    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="tier")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="tier")

    @property
    def tickets_remaining(self) -> int:
        return self.capacity - self.tickets_sold


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    tier_id: Mapped[str | None] = mapped_column(ForeignKey("event_tiers.id"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Which gate device checked this ticket in, if any — populated once GateScanner
    # registration exists (Phase 2); left null in Phase 1.
    gate_scanner_id: Mapped[str | None] = mapped_column(ForeignKey("gate_scanners.id"))
    # Set only for the 2nd+ ticket in a quantity>1 purchase — the 1st ticket is
    # still linked the original way, via Payment.ticket_id. Lets one payment
    # activate/mint every ticket it covers, not just the first.
    # Named + use_alter: tickets and payments reference each other, and a
    # cycle can only be created/dropped (create_all, test teardown on
    # Postgres) if one side is a separately-named ALTER. Same name the
    # migration (5b8936e65664) gives it.
    group_payment_id: Mapped[str | None] = mapped_column(
        ForeignKey("payments.id", name="fk_tickets_group_payment_id", use_alter=True)
    )

    status: Mapped[TicketStatus] = mapped_column(
        SAEnum(TicketStatus), default=TicketStatus.PENDING_PAYMENT
    )

    # NFT details (populated in the smart-contract phase of the roadmap)
    nft_token_id: Mapped[int | None] = mapped_column(Integer)
    nft_tx_hash: Mapped[str | None] = mapped_column(String(66))
    # Which TiketiNFT contract it was minted on. Null for tickets minted
    # before this was recorded: web3_service.ticket_contract_address.
    nft_contract_address: Mapped[str | None] = mapped_column(String(42))
    # The markUsed transaction once the ticket was admitted at the gate.
    used_tx_hash: Mapped[str | None] = mapped_column(String(66))

    # Seat info (if applicable)
    seat_number: Mapped[str | None] = mapped_column(String(20))

    # Issued free by the organiser (Control Center "Send Complimentary
    # Tickets") — no Payment row exists for these.
    is_complimentary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    complimentary_note: Mapped[str | None] = mapped_column(String(255))
    recipient_name: Mapped[str | None] = mapped_column(String(100))

    # Timestamps
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    event: Mapped["Event"] = relationship("Event", back_populates="tickets")
    tier: Mapped["EventTier | None"] = relationship("EventTier", back_populates="tickets")
    owner: Mapped["User"] = relationship("User", back_populates="tickets")
    # A list, not a single object — a ticket gets one Payment for its original
    # purchase, then one more each time it's resold.
    # foreign_keys is explicit because Payment.ticket_id -> tickets.id and
    # tickets.group_payment_id -> payments.id form two distinct FK paths
    # between these two tables — SQLAlchemy can't infer which one this
    # relationship means without being told.
    payments: Mapped[list["Payment"]] = relationship(
        "Payment",
        back_populates="ticket",
        foreign_keys="Payment.ticket_id",
        order_by="Payment.initiated_at",
    )
    barcodes: Mapped[list["Barcode"]] = relationship("Barcode", back_populates="ticket")

    @property
    def current_barcode(self) -> "Barcode | None":
        """The active credential for this ticket — supports future rotation/reissue
        (transfer, lost-device recovery) without losing barcode history."""
        active = [b for b in self.barcodes if b.status == BarcodeStatus.ACTIVE]
        return max(active, key=lambda b: b.token_version) if active else None

    @property
    def totp_secret(self) -> str | None:
        """Compatibility shim — routes keep reading `ticket.totp_secret` even though the
        seed now lives on the ticket's current Barcode row instead of a column here.

        Barcode.token is encrypted at rest (Work Order 04 A4) — this is the
        one place it gets decrypted back to the raw base32 secret. Every
        caller (gate.py's scan handler, the gate-sync payload, tickets.py's
        seed/QR endpoints) reads through this property rather than the
        column directly, so none of them need to know encryption exists."""
        barcode = self.current_barcode
        if not barcode:
            return None
        from app.core.crypto import decrypt_secret
        return decrypt_secret(barcode.token)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Not unique — a ticket has one Payment for its original purchase, then
    # one more each time it's resold (see Transfer.payment_id).
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), nullable=False)
    tier_id: Mapped[str | None] = mapped_column(ForeignKey("event_tiers.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    # How many tickets this single payment covers — 1 for a resale purchase
    # or a normal single-ticket buy, >1 when bought together via /purchase's
    # quantity field. amount_kes is the TOTAL for all of them, not per-ticket.
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    amount_kes: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus), default=PaymentStatus.INITIATED
    )

    # Daraja fields
    merchant_request_id: Mapped[str | None] = mapped_column(String(100), index=True)
    checkout_request_id: Mapped[str | None] = mapped_column(String(100), index=True, unique=True)
    mpesa_receipt_number: Mapped[str | None] = mapped_column(String(50))  # e.g. OEI2AK4MFU
    # The M-Pesa number charged; for a card payment, the buyer's own number.
    phone_number: Mapped[str] = mapped_column(String(15), nullable=False)

    # "mpesa" (an STK push: the Daraja fields above) or "card" (a Paystack
    # transaction: the fields below). See app/services/paystack_service.py.
    method: Mapped[str] = mapped_column(String(10), default="mpesa", server_default="mpesa", nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(String(100), index=True, unique=True)  # Paystack reference
    provider_transaction_id: Mapped[str | None] = mapped_column(String(50))  # Paystack's transaction ID
    card_brand: Mapped[str | None] = mapped_column(String(20))   # visa, mastercard, amex…
    card_last4: Mapped[str | None] = mapped_column(String(4))

    initiated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    failure_reason: Mapped[str | None] = mapped_column(String(255))

    ticket: Mapped["Ticket"] = relationship("Ticket", back_populates="payments", foreign_keys=[ticket_id])
    tier: Mapped["EventTier | None"] = relationship("EventTier", back_populates="payments")
    user: Mapped["User"] = relationship("User", back_populates="payments")

    @property
    def reference(self) -> str | None:
        """The provider's own reference: the M-Pesa receipt or the Paystack reference."""
        return self.provider_reference if self.method == "card" else self.mpesa_receipt_number

    @property
    def paid_with(self) -> str | None:
        """How the buyer paid, as they'd recognise it: "M-Pesa OEI2AK4MFU" or "Visa •••• 4242"."""
        if self.method == "card":
            if self.status != PaymentStatus.SUCCESS:
                return None
            brand = {"amex": "American Express", "mastercard": "Mastercard"}.get(self.card_brand or "", (self.card_brand or "Card").title())
            return f"{brand} •••• {self.card_last4}" if self.card_last4 else brand
        return f"M-Pesa {self.mpesa_receipt_number}" if self.mpesa_receipt_number else None


class Barcode(Base):
    """
    A versioned ticket credential. Replaces the old single `Ticket.totp_secret` column —
    keeping a history table lets a credential be rotated or reissued (transfer, device loss)
    without losing the trail, per the report's "barcodes" entity.
    """
    __tablename__ = "barcodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), nullable=False)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    # Fernet-encrypted base32 TOTP secret seed (Work Order 04 A4) — a Fernet
    # token is well over the plaintext's 32 chars, hence Text rather than
    # the String(64) this column started as.
    token: Mapped[str] = mapped_column(Text, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[BarcodeStatus] = mapped_column(SAEnum(BarcodeStatus), default=BarcodeStatus.ACTIVE)
    # Unused until Phase 4 (client-side rotation/offline validation) needs an expiry window
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    ticket: Mapped["Ticket"] = relationship("Ticket", back_populates="barcodes")


class PriceCap(Base):
    """Audit trail of resale price-bound adjustments for a tier. Not yet wired to any route."""
    __tablename__ = "price_caps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    tier_id: Mapped[str] = mapped_column(ForeignKey("event_tiers.id"), nullable=False)

    cap_price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    floor_price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    change_type: Mapped[PriceCapChangeType] = mapped_column(
        SAEnum(PriceCapChangeType), default=PriceCapChangeType.INITIAL
    )
    effective_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Transfer(Base):
    """
    A resale listing and, if it sells, the completed secondary-market
    transaction — one row covers the whole lifecycle (Work Order 02).

    created_at is when the listing was made; transferred_at is set only once
    the sale actually completes (on-chain settlement succeeded), so it stays
    null for a listing that's merely active, cancelled, or expired.
    """
    __tablename__ = "transfers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), nullable=False)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    seller_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    buyer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))

    transfer_type: Mapped[TransferType] = mapped_column(SAEnum(TransferType), default=TransferType.RESALE)
    status: Mapped[TransferStatus] = mapped_column(SAEnum(TransferStatus), default=TransferStatus.LISTED)

    # The seller's ask (set at listing time) vs. the price actually paid
    # (frozen at settlement — for resale today these are always equal, since
    # there's no offer/negotiation flow, but the work order asks for both to
    # exist as distinct fields rather than conflating "listed for" with "sold for").
    asking_price_kes: Mapped[float] = mapped_column(Float, nullable=False)
    transfer_price_kes: Mapped[float | None] = mapped_column(Float)

    # Frozen at settlement — computed live (as a hint) from asking_price_kes
    # while a listing is merely active; see app/api/routes/resale.py.
    organizer_royalty_kes: Mapped[float | None] = mapped_column(Float)
    platform_fee_kes: Mapped[float | None] = mapped_column(Float)
    seller_payout_kes: Mapped[float | None] = mapped_column(Float)

    # On-chain evidence trail
    listing_tx_hash: Mapped[str | None] = mapped_column(String(66))
    settlement_tx_hash: Mapped[str | None] = mapped_column(String(66))

    views: Mapped[int] = mapped_column(Integer, default=0)
    pause_reason: Mapped[str | None] = mapped_column(String(255))

    transferred_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    ticket: Mapped["Ticket"] = relationship("Ticket")
    event: Mapped["Event"] = relationship("Event")
    seller: Mapped["User"] = relationship("User", foreign_keys=[seller_id])
    buyer: Mapped["User | None"] = relationship("User", foreign_keys=[buyer_id])
    payment: Mapped["Payment | None"] = relationship("Payment")


class GateScanner(Base):
    """
    A registered gate-scanning device. Wired via app/api/routes/gate.py's
    /gate/scanners (register + revoke) and /gate/enroll (Work Order 04 B4).

    Lifecycle: an organiser registers intent for one event+gate
    (device_id/device_token_hash null, enrollment_code set, status
    INACTIVE) -> the physical device submits that code once via
    /gate/enroll, choosing its own device_id and receiving a long-lived
    device token in return (enrollment_code cleared, device_token_hash
    set, status ACTIVE) -> sync/scan-upload authenticate with that token,
    not a user JWT (app.core.authz.get_current_scanner). Revoking sets
    status back to INACTIVE, which invalidates the token immediately
    (get_current_scanner requires ACTIVE).
    """
    __tablename__ = "gate_scanners"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    organizer_id: Mapped[str | None] = mapped_column(ForeignKey("organizers.id"))
    account_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))  # operator account

    gate_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Human label the organiser gave the device ("Gate A — Scanner 1").
    label: Mapped[str | None] = mapped_column(String(100))
    # Nullable until the device actually enrolls — registration (the
    # organiser's step) happens before any physical device has connected or
    # chosen an id for itself.
    device_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    # Single-use, time-limited — consumed and cleared by /gate/enroll.
    enrollment_code: Mapped[str | None] = mapped_column(String(20), index=True)
    enrollment_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    # SHA-256 of the long-lived device token — the token itself is never
    # stored, only ever returned once at enrolment time, same reasoning as
    # not storing a password or API key in plaintext.
    device_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[GateScannerStatus] = mapped_column(
        SAEnum(GateScannerStatus), default=GateScannerStatus.ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Attendance(Base):
    """A single scan attempt at the gate, admitted or denied. Wired via
    POST /gate/scan-upload (Work Order 05 B5) — the offline scanner's
    reconciliation endpoint, written once connectivity returns — and by
    the Organiser Console's Live QR Scanner, which checks online and
    records each decision as it makes it."""
    __tablename__ = "attendances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Null when the scanned QR named a ticket that doesn't exist (a forged
    # or garbled code) — the raw id is kept in scanned_ref instead, so those
    # denials are still recorded (they're the most interesting ones).
    ticket_id: Mapped[str | None] = mapped_column(ForeignKey("tickets.id"))
    scanned_ref: Mapped[str | None] = mapped_column(String(64))
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    scanner_id: Mapped[str | None] = mapped_column(ForeignKey("gate_scanners.id"))

    scan_time: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    status: Mapped[AttendanceStatus] = mapped_column(SAEnum(AttendanceStatus), nullable=False)
    # One of validate.js's REASON codes (UNKNOWN_TICKET, BAD_OTP,
    # ALREADY_ADMITTED, WRONG_GATE, INVALID_FORMAT) — null for an admitted
    # scan, since there's nothing to explain (Work Order 05 B2).
    denial_reason: Mapped[str | None] = mapped_column(String(30))


class AuditLog(Base):
    """System/actor action trail. Not yet wired to any route."""
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))  # null for system actions
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(36))
    target_type: Mapped[str | None] = mapped_column(String(50))
    # Free text: a manual override's reason, an export's type/format, etc.
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class WalletTransaction(Base):
    """
    A seller's earnings ledger (Work Order 02). One row per completed resale
    payout or M-Pesa withdrawal. A withdrawal's status follows its Payout:
    pending while it's being sent, failed (and back in the balance) if it
    didn't go through. No table for this existed in the original
    14-table schema — resale payouts are new money movement this project
    didn't have before, so this is an addition, not a repurposing of an
    unwired table like Transfer was.

    available_at gates a "sale" row out of the available balance until the
    event has actually happened (+2 days) — mirroring the frontend's own
    escrow-window convention (see EscrowBanner.jsx) rather than inventing a
    different one. There is no dispute system built in this work order, so
    unlike the mock's computeWallet(), nothing here ever holds a balance for
    a dispute — the "on hold" bucket a real dispute system would feed stays
    permanently 0 until that feature exists.
    """
    __tablename__ = "wallet_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    transfer_id: Mapped[str | None] = mapped_column(ForeignKey("transfers.id"))

    type: Mapped[WalletTransactionType] = mapped_column(SAEnum(WalletTransactionType), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    # Signed KES — positive for a sale payout, negative for a withdrawal.
    amount_kes: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[WalletTransactionStatus] = mapped_column(
        SAEnum(WalletTransactionStatus), default=WalletTransactionStatus.SUCCESS
    )
    available_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Payout(Base):
    """
    Money ChainTix sends out: a seller withdrawing their wallet, or an
    organiser's payout request. app/services/payouts.py moves it through
    its stages; Safaricom's B2C API pays an M-Pesa number and its B2B API a
    paybill or till.

    amount_kes leaves the recipient's balance the moment the payout is
    created, so the same money can't be requested twice. charge_kes is
    Safaricom's transfer charge, taken off it, and net_kes is what is sent.
    A failed or rejected payout gives amount_kes back.

    The destination is copied in at request time, so an admin approves
    exactly where the money will go.
    """
    __tablename__ = "payouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient_type: Mapped[str] = mapped_column(String(10), nullable=False)  # "seller" | "organiser"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)  # the seller, or who requested it
    organizer_id: Mapped[str | None] = mapped_column(ForeignKey("organizers.id"), index=True)
    wallet_transaction_id: Mapped[str | None] = mapped_column(ForeignKey("wallet_transactions.id"))

    channel: Mapped[str] = mapped_column(String(10), nullable=False)  # "mpesa" | "paybill" | "till"
    destination: Mapped[str] = mapped_column(String(20), nullable=False)
    account_reference: Mapped[str | None] = mapped_column(String(20))
    destination_label: Mapped[str | None] = mapped_column(String(100))

    amount_kes: Mapped[float] = mapped_column(Float, nullable=False)
    charge_kes: Mapped[float] = mapped_column(Float, nullable=False)
    net_kes: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[PayoutStatus] = mapped_column(SAEnum(PayoutStatus), nullable=False)

    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_note: Mapped[str | None] = mapped_column(Text)

    # Safaricom's side. originator_conversation_id is ChainTix's own for
    # B2C (this payout's id, so a resend can never pay twice) and
    # Safaricom's for B2B.
    originator_conversation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str | None] = mapped_column(String(64), index=True)
    mpesa_receipt: Mapped[str | None] = mapped_column(String(20))
    recipient_name: Mapped[str | None] = mapped_column(String(255))  # as M-Pesa shows it
    result_code: Mapped[str | None] = mapped_column(String(20))
    result_desc: Mapped[str | None] = mapped_column(Text)
    result_payload: Mapped[dict | None] = mapped_column(JSON)
    # Paid outside Daraja (e.g. from the M-Pesa business app) and recorded by an admin.
    manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    organizer: Mapped["Organizer | None"] = relationship("Organizer")


class Notification(Base):
    """Outbound message record. Written for every email ChainTix sends
    (app/worker.py): reference is what it was about (a payment or transfer
    id), so a retried task never sends the same receipt twice."""
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False)
    channel: Mapped[str] = mapped_column(String(20), default="sms")
    reference: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus), default=NotificationStatus.PENDING
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


# ─── Platform Admin ──────────────────────────────────────────────────────────

class FeeSchedule(Base):
    """
    Platform fees, one row per change (Admin → Fee Configuration). The row
    in effect at a moment is the latest with effective_from <= that moment,
    so a change applies going forward only: a sale is always charged at the
    rates in force when it was paid. No rows means the built-in defaults
    (app/services/platform_settings.py).
    """
    __tablename__ = "fee_schedule"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    platform_fee_percent: Mapped[float] = mapped_column(Float, nullable=False)
    scanning_fee_kes: Mapped[float] = mapped_column(Float, nullable=False)
    min_payout_kes: Mapped[float] = mapped_column(Float, nullable=False)
    seller_escrow_days: Mapped[int] = mapped_column(Integer, nullable=False)
    organiser_escrow_days: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class FeatureFlag(Base):
    """A switch an admin flips in Feature Flags. Every key is defined, with
    its default and what it controls, in app/services/platform_settings.py;
    a row exists only once an admin has changed it."""
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    rollout_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Broadcast(Base):
    """An announcement from Communication Center. Delivered in-app: the
    site shows it to its audience from scheduled_for (or creation) on."""
    __tablename__ = "broadcasts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    message: Mapped[str] = mapped_column(Text, nullable=False)
    channels: Mapped[list] = mapped_column(JSON, nullable=False)
    audience: Mapped[str] = mapped_column(String(20), nullable=False)  # all | attendees | organisers | gate_staff
    audience_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class AdminInvite(Base):
    """A pending platform-admin invite for a phone number with no account
    yet. Applied (and deleted) the first time that number signs in —
    app/services/auth_service.issue_session."""
    __tablename__ = "admin_invites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number: Mapped[str] = mapped_column(String(15), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    invited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
