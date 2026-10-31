"""
Card payments through Paystack Checkout.

The buyer is sent to a payment page hosted by Paystack, so card details never
touch this server. A payment is confirmed two ways, whichever comes first:
  - Paystack's webhook (charge.success), signed with the secret key — see
    verify_webhook below;
  - the checkout page polling GET /payments/{id}/status after the buyer
    comes back, which verifies the transaction with Paystack directly. That
    one is what makes cards work on a laptop, where Paystack can't reach
    the webhook.

Each transaction's Paystack reference is our Payment.id. Talks to Paystack's
REST API with httpx, the same way app/services/mpesa.py talks to Daraja.
"""
import hashlib
import hmac
import json
import logging

import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

API = "https://api.paystack.co"


class PaystackError(Exception):
    """Paystack refused a request; the message is Paystack's own, safe to show."""


def _request(method: str, path: str, body: dict | None = None) -> dict:
    try:
        response = httpx.request(
            method, f"{API}{path}", json=body,
            headers={"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}"}, timeout=20,
        )
    except httpx.HTTPError as e:
        raise PaystackError(f"Couldn't reach Paystack: {e}") from e
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400 or not payload.get("status"):
        message = payload.get("message") or f"Paystack returned {response.status_code}"
        logger.warning(f"Paystack {method} {path} failed: {message}")
        raise PaystackError(message)
    return payload.get("data") or {}


def amount_subunits(amount_kes: float) -> int:
    """Paystack takes KES in cents."""
    return round(amount_kes * 100)


def initialize_transaction(*, reference: str, amount_kes: float, email: str, description: str,
                           callback_url: str, cancel_url: str) -> dict:
    """Open a card payment for `amount_kes`. Returns {authorization_url,
    access_code, reference}; authorization_url is the page to send the buyer to."""
    return _request("POST", "/transaction/initialize", {
        "reference": reference,
        "amount": str(amount_subunits(amount_kes)),
        "currency": "KES",
        "email": email,
        "channels": ["card"],
        "callback_url": callback_url,
        # cancel_action: where Paystack's "Cancel payment" link sends the buyer.
        "metadata": json.dumps({
            "payment_id": reference,
            "cancel_action": cancel_url,
            "custom_fields": [{"display_name": "Order", "variable_name": "order", "value": description[:200]}],
        }),
    })


def verify_transaction(reference: str) -> dict:
    """The transaction as Paystack has it: status ("success", "failed",
    "abandoned", …), amount, currency, and the card used (authorization)."""
    return _request("GET", f"/transaction/verify/{reference}")


def card_details(transaction: dict) -> dict:
    """{transaction_id, card_brand, card_last4} from a verified transaction; any may be None."""
    auth = transaction.get("authorization") or {}
    brand = (auth.get("brand") or auth.get("card_type") or "").strip().lower() or None
    return {
        "transaction_id": str(transaction["id"]) if transaction.get("id") else None,
        "card_brand": brand,
        "card_last4": auth.get("last4"),
    }


def verify_webhook(payload: bytes, signature: str | None) -> dict:
    """
    Paystack signs each webhook: the x-paystack-signature header is an
    HMAC-SHA512 of the raw body with the secret key. Returns the parsed
    event, or raises ValueError for anything not provably from Paystack.
    """
    if not settings.PAYSTACK_SECRET_KEY:
        raise ValueError("PAYSTACK_SECRET_KEY isn't set")
    expected = hmac.new(settings.PAYSTACK_SECRET_KEY.encode(), payload, hashlib.sha512).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise ValueError("Paystack webhook signature mismatch")
    return json.loads(payload)
