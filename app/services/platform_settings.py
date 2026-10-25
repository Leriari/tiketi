"""
Settings a platform admin changes at runtime: the fee schedule and feature
flags. Both fall back to the defaults defined here when nothing has been
saved, so a fresh database (or the test suite's create_all one) behaves
exactly as the platform did before these were configurable.
"""
import hashlib
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.constants import MIN_WITHDRAWAL_KES, PLATFORM_FEE_PERCENT
from app.models.models import FeatureFlag, FeeSchedule


# ── Fees ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Fees:
    platform_fee_percent: float
    scanning_fee_kes: float
    min_payout_kes: float
    seller_escrow_days: int
    organiser_escrow_days: int
    effective_from: datetime | None = None

    def as_api(self) -> dict:
        return {
            "platformFeePercent": self.platform_fee_percent,
            "scanningFeeKes": self.scanning_fee_kes,
            "minPayoutKes": self.min_payout_kes,
            "sellerEscrowDays": self.seller_escrow_days,
            "organiserEscrowDays": self.organiser_escrow_days,
            "effectiveFrom": self.effective_from or datetime(2026, 1, 1),
        }


DEFAULT_FEES = Fees(
    platform_fee_percent=PLATFORM_FEE_PERCENT,
    scanning_fee_kes=10.0,
    min_payout_kes=MIN_WITHDRAWAL_KES,
    seller_escrow_days=2,
    organiser_escrow_days=4,
)


def fees_from_row(row: FeeSchedule) -> Fees:
    return Fees(row.platform_fee_percent, row.scanning_fee_kes, row.min_payout_kes,
                row.seller_escrow_days, row.organiser_escrow_days, row.effective_from)


class FeeHistory:
    """Every schedule row, loaded once, for pricing many past transactions
    (the organiser ledger) without a query per row."""

    def __init__(self, db: Session):
        self._rows = [fees_from_row(r) for r in db.query(FeeSchedule).order_by(FeeSchedule.effective_from).all()]

    def at(self, when: datetime | None) -> Fees:
        if when is None:
            return self.current()
        found = DEFAULT_FEES
        for fees in self._rows:
            if fees.effective_from <= when:
                found = fees
            else:
                break
        return found

    def current(self) -> Fees:
        return self._rows[-1] if self._rows else DEFAULT_FEES


def current_fees(db: Session) -> Fees:
    row = db.query(FeeSchedule).order_by(FeeSchedule.effective_from.desc()).first()
    return fees_from_row(row) if row else DEFAULT_FEES


# ── Feature flags ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FlagSpec:
    key: str
    label: str
    description: str
    default_enabled: bool
    # Whether a partial rollout means anything for this flag (what it's
    # bucketed by is in the description); if not, the page shows no slider.
    supports_rollout: bool


FLAGS = [
    FlagSpec(
        "event_approval", "Approve events before they go live",
        "A new event from an organisation ChainTix hasn't verified waits in Event Approvals instead of "
        "going live. Verified organisations still publish instantly. Rollout picks organisations.",
        default_enabled=False, supports_rollout=True,
    ),
    FlagSpec(
        "resale_marketplace", "Resale marketplace",
        "Ticket holders can list tickets for resale and buy listed ones. Off: no new listings or "
        "purchases; existing listings stay visible. Rollout picks which sellers can list.",
        default_enabled=True, supports_rollout=True,
    ),
    FlagSpec(
        "simulated_payments", "Simulated M-Pesa success",
        "Shows testers a button that completes checkout without an M-Pesa prompt. Only has an effect "
        "on servers started with ALLOW_SIMULATED_PAYMENTS (sandbox).",
        default_enabled=True, supports_rollout=False,
    ),
]
FLAG_SPECS = {f.key: f for f in FLAGS}


def flag_state(db: Session, key: str) -> tuple[bool, int]:
    spec = FLAG_SPECS[key]
    row = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    if row is None:
        return spec.default_enabled, 100 if spec.default_enabled else 0
    return row.enabled, row.rollout_percent


def flag_on(db: Session, key: str, subject_id: str | None = None) -> bool:
    """Is the flag on — for this subject, when it's rolled out to a
    percentage? The same subject always lands in the same bucket."""
    enabled, rollout = flag_state(db, key)
    if not enabled or rollout <= 0:
        return False
    if rollout >= 100 or subject_id is None or not FLAG_SPECS[key].supports_rollout:
        return True
    bucket = int(hashlib.sha256(f"{key}:{subject_id}".encode()).hexdigest(), 16) % 100
    return bucket < rollout
