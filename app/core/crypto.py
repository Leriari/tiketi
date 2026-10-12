"""
At-rest encryption for the TOTP secret seed stored in Barcode.token (Work
Order 04 A4) — the most sensitive data this project holds: anyone who
reads that column in plaintext can generate a valid credential for every
ticket in the system.

Fernet (symmetric, authenticated) is sufficient here — this is encryption
at rest behind a single backend-held key, not a public-key scheme or a
multi-tenant KMS setup. Decrypt only where a code must actually be
computed or synced (see Ticket.totp_secret in app/models/models.py, which
is the single place this gets called from in request-serving code).
"""
from functools import lru_cache
from cryptography.fernet import Fernet
from app.core.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    return Fernet(get_settings().CREDENTIAL_ENCRYPTION_KEY.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
