import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime,
    ForeignKey, Enum as SAEnum, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
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
    PUBLISHED  = "published"
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


# ─── Models ───────────────────────────────────────────────────────────────────

class User(Base):
    """Maps to the report's "accounts" entity."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number: Mapped[str] = mapped_column(String(15), unique=True, index=True, nullable=False)
    # Phone is the identity — no password needed (OTP-based auth)
    display_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
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
    # Nothing in the codebase can set this to True except the CLI script
    # scripts/promote_platform_admin.py, run manually against the database —
    # see B5: there must be no code path that lets a user grant it to
    # themselves.
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="owner")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="user")


class Organizer(Base):
    """A verified event-organizing business. Wired via app/api/routes/organisations.py
    (Work Order 04 B2) — onboarding only, no verification workflow is built;
    verification_status is set PENDING and never progressed automatically."""
    __tablename__ = "organizers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kra_pin: Mapped[str | None] = mapped_column(String(20))
    verification_status: Mapped[OrganizerVerificationStatus] = mapped_column(
        SAEnum(OrganizerVerificationStatus), default=OrganizerVerificationStatus.PENDING
    )
    mpesa_paybill: Mapped[str | None] = mapped_column(String(20))
    royalty_wallet_address: Mapped[str | None] = mapped_column(String(42))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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

    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="event")
    tiers: Mapped[list["EventTier"]] = relationship(
        "EventTier", back_populates="event", order_by="EventTier.created_at"
    )

    @property
    def tickets_remaining(self) -> int:
        return self.total_capacity - self.tickets_sold

    @property
    def default_tier(self) -> "EventTier | None":
        """Phase 1 only ever creates one tier per event; multi-tier selection lands in Phase 2."""
        return self.tiers[0] if self.tiers else None

    # ── Compatibility shims — Phase 1 keeps the flat pricing API surface stable
    # while the underlying storage moves to EventTier, per the report's design. ──

    @property
    def ticket_price_kes(self) -> float:
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
    group_payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id"))

    status: Mapped[TicketStatus] = mapped_column(
        SAEnum(TicketStatus), default=TicketStatus.PENDING_PAYMENT
    )

    # NFT details (populated in the smart-contract phase of the roadmap)
    nft_token_id: Mapped[int | None] = mapped_column(Integer)
    nft_tx_hash: Mapped[str | None] = mapped_column(String(66))

    # Seat info (if applicable)
    seat_number: Mapped[str | None] = mapped_column(String(20))

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
    phone_number: Mapped[str] = mapped_column(String(15), nullable=False)

    initiated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    failure_reason: Mapped[str | None] = mapped_column(String(255))

    ticket: Mapped["Ticket"] = relationship("Ticket", back_populates="payments", foreign_keys=[ticket_id])
    tier: Mapped["EventTier | None"] = relationship("EventTier", back_populates="payments")
    user: Mapped["User"] = relationship("User", back_populates="payments")


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
    """A single scan attempt at the gate, admitted or denied. Not yet wired to any route —
    today's gate.py still mutates Ticket.status/used_at directly; this table will record the
    fact of the attempt separately once gate-scanner device registration exists (Phase 2)."""
    __tablename__ = "attendances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), nullable=False)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), nullable=False)
    scanner_id: Mapped[str | None] = mapped_column(ForeignKey("gate_scanners.id"))

    scan_time: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    status: Mapped[AttendanceStatus] = mapped_column(SAEnum(AttendanceStatus), nullable=False)


class AuditLog(Base):
    """System/actor action trail. Not yet wired to any route."""
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))  # null for system actions
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(36))
    target_type: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class WalletTransaction(Base):
    """
    A seller's earnings ledger (Work Order 02). One row per completed resale
    payout or M-Pesa withdrawal. No table for this existed in the original
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


class Notification(Base):
    """Outbound message record (SMS/push/email). Not yet wired to any route."""
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False)
    channel: Mapped[str] = mapped_column(String(20), default="sms")
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus), default=NotificationStatus.PENDING
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
