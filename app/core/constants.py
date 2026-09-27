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
