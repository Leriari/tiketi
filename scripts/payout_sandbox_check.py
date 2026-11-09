"""
End-to-end check of M-Pesa payouts against the Daraja SANDBOX: one B2C
(a seller withdrawal) and one B2B (an organiser payout to a paybill),
through the real payout code, with Safaricom's results arriving at this
server's public result URLs. Run it on the server, where those URLs are:

    cd ~/tiketi/deploy
    docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
      python scripts/payout_sandbox_check.py

Refuses to run unless MPESA_ENV=sandbox and payouts are configured. It
creates clearly-labelled test records ("Sandbox payout test ..."): a user
on the sandbox test number with a KES 300 credit that is not a real sale,
and a verified organisation paid to the sandbox paybill 600000. They show
in the admin Payout Queue as the evidence. Re-running reuses them.
"""
import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.models import (
    Organizer, OrganizerVerificationStatus, Payout, PayoutStatus, User, WalletTransaction,
    WalletTransactionStatus, WalletTransactionType,
)
from app.services import payouts

SANDBOX_MSISDN = "254708374149"  # Daraja's published sandbox test number
SANDBOX_PAYBILL = "600000"
TAG = "Sandbox payout test"


def _test_records(db) -> tuple[User, Organizer]:
    user = db.query(User).filter(User.phone_number == SANDBOX_MSISDN).first()
    if not user:
        user = User(phone_number=SANDBOX_MSISDN, display_name=f"{TAG} user", phone_verified=False)
        db.add(user)
        db.flush()
    db.add(WalletTransaction(
        user_id=user.id, type=WalletTransactionType.SALE, amount_kes=300,
        description=f"{TAG} credit (not a real sale)", status=WalletTransactionStatus.SUCCESS,
    ))
    org = db.query(Organizer).filter(Organizer.business_name == f"{TAG} organisation").first()
    if not org:
        org = Organizer(business_name=f"{TAG} organisation", verification_status=OrganizerVerificationStatus.VERIFIED)
        db.add(org)
    org.payout_method, org.payout_destination = "paybill", SANDBOX_PAYBILL
    org.payout_account, org.payout_label = "CHAINTIX", "Daraja sandbox paybill"
    db.commit()
    return user, org


def _show(label: str, payout: Payout) -> None:
    print(f"{label:4} {payout.status.value:10} KES {payout.amount_kes:,.0f} - {payout.charge_kes:,.0f} charge "
          f"= {payout.net_kes:,.0f} | code {payout.result_code} | receipt {payout.mpesa_receipt} "
          f"| to {payout.recipient_name} | {payout.result_desc}")


async def main(wait_seconds: int) -> int:
    settings = get_settings()
    if settings.MPESA_ENV != "sandbox" or not settings.MPESA_PAYOUTS_CONFIGURED:
        print("Needs MPESA_ENV=sandbox and the Daraja payout settings. Nothing done.")
        return 1

    db = SessionLocal()
    user, org = _test_records(db)

    b2c = payouts.create_seller_withdrawal(db, user, 100)
    db.commit()
    await payouts.send(db, b2c)
    _show("B2C", b2c)

    b2b = payouts.create_organiser_payout(db, org, user, 200)
    db.commit()
    await payouts.approve(db, b2b, user)
    _show("B2B", b2b)
    ids = {"B2C": b2c.id, "B2B": b2b.id}
    db.close()

    print(f"Sent. Waiting up to {wait_seconds}s for Safaricom's results...")
    deadline = time.time() + wait_seconds
    while True:
        time.sleep(5)
        db = SessionLocal()
        rows = {label: db.get(Payout, pid) for label, pid in ids.items()}
        settled = all(p.status != PayoutStatus.PROCESSING for p in rows.values())
        if settled or time.time() > deadline:
            for label, payout in rows.items():
                _show(label, payout)
            db.close()
            if not settled:
                print("Still processing: no result yet. Use \"Check status with M-Pesa\" in the admin Payout Queue.")
            return 0 if all(p.status == PayoutStatus.PAID for p in rows.values()) else 2
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--wait", type=int, default=120, help="seconds to wait for results (default 120)")
    sys.exit(asyncio.run(main(parser.parse_args().wait)))
