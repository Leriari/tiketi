"""
Small shared constants with no dependencies of their own — safe to import
from both app/worker.py and app/api/routes/resale.py without risking a
circular import between them.
"""

# Platform's cut of every resale, matching the frontend's own (previously
# mock-only) PLATFORM_FEE_PERCENT constant — Work Order 02 makes this the
# real, single source of truth instead of a duplicated hardcoded value.
PLATFORM_FEE_PERCENT = 5.0

MIN_WITHDRAWAL_KES = 101.0

# What Safaricom charges ChainTix to send one payout, as (up to KES, charge).
# The charge is taken off the payout, so the recipient gets amount − charge.
# This is Safaricom's B2C tariff for registered M-Pesa users (2025 "Bulk
# Payment" tariff form, business pays, option 1). B2B to a paybill or till
# is charged at the same bands here as an estimate; Safaricom reports the
# real charge in each result (Payout.result_payload). Check both against
# the current tariff before real money moves.
PAYOUT_CHARGE_BANDS = (
    (1_500, 5.0),
    (5_000, 9.0),
    (20_000, 11.0),
    (250_000, 13.0),
)
MAX_PAYOUT_KES = 250_000.0  # Safaricom's per-transaction limit for B2C


def payout_charge_kes(amount_kes: float) -> float:
    for upper, charge in PAYOUT_CHARGE_BANDS:
        if amount_kes <= upper:
            return charge
    return PAYOUT_CHARGE_BANDS[-1][1]
