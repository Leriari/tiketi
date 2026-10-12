"""
Promote a user to PLATFORM_ADMIN (Work Order 04 B5).

There is no code path anywhere in the application that lets a user grant
themselves this role — it is intentionally only reachable by running this
script manually against the database. No environment variable auto-promotes
on startup either: a leaked or copied .env would otherwise mint an admin.

Usage:
    python scripts/promote_platform_admin.py <phone_number>
    python scripts/promote_platform_admin.py <phone_number> --revoke
"""
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal
from app.models.models import User
from app.schemas.schemas import normalize_kenyan_phone


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phone_number", help="The user's phone number, e.g. 0712345678")
    parser.add_argument("--revoke", action="store_true", help="Remove platform admin instead of granting it")
    args = parser.parse_args()

    phone = normalize_kenyan_phone(args.phone_number)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.phone_number == phone).first()
        if not user:
            print(f"No user found with phone number {phone}. They must log in at least once first.")
            sys.exit(1)

        user.is_platform_admin = not args.revoke
        db.commit()

        action = "revoked from" if args.revoke else "granted to"
        print(f"PLATFORM_ADMIN {action} {phone} (user_id={user.id}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
