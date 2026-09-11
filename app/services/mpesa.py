"""
M-Pesa Daraja API service.
Handles:
  - OAuth token generation (cached)
  - STK Push (Lipa Na M-Pesa Online)
  - Callback parsing and payment confirmation
"""
import base64
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


# ─── Token Cache (simple in-memory; use Redis in production) ──────────────────
_token_cache: dict = {"token": None, "expires_at": 0}


async def get_access_token() -> str:
    """Fetch (or return cached) Daraja OAuth2 bearer token."""
    now = datetime.now(timezone.utc).timestamp()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    credentials = f"{settings.MPESA_CONSUMER_KEY}:{settings.MPESA_CONSUMER_SECRET}"
    encoded = base64.b64encode(credentials.encode()).decode()

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{settings.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials",
            headers={"Authorization": f"Basic {encoded}"},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()

    _token_cache["token"] = data["access_token"]
    # Daraja tokens last 3600s — cache for 3500s to be safe
    _token_cache["expires_at"] = now + 3500
    return _token_cache["token"]


def _generate_password(timestamp: str) -> str:
    """
    Daraja password = Base64(Shortcode + Passkey + Timestamp)
    """
    raw = f"{settings.MPESA_SHORTCODE}{settings.MPESA_PASSKEY}{timestamp}"
    return base64.b64encode(raw.encode()).decode()


async def stk_push(
    phone_number: str,
    amount: int,
    account_reference: str,
    transaction_desc: str,
) -> dict:
    """
    Initiate Lipa Na M-Pesa Online (STK Push).

    Args:
        phone_number:       In format 2547XXXXXXXX
        amount:             KES amount (integer)
        account_reference:  Shown on customer's M-Pesa statement (e.g. ticket ID)
        transaction_desc:   Short description

    Returns:
        Daraja response dict with MerchantRequestID and CheckoutRequestID
    """
    token = await get_access_token()
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = _generate_password(timestamp)

    payload = {
        "BusinessShortCode": settings.MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": amount,
        "PartyA": phone_number,           # customer phone
        "PartyB": settings.MPESA_SHORTCODE,
        "PhoneNumber": phone_number,
        "CallBackURL": settings.MPESA_CALLBACK_URL,
        "AccountReference": account_reference[:12],  # max 12 chars
        "TransactionDesc": transaction_desc[:13],     # max 13 chars
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        response.raise_for_status()

    result = response.json()
    logger.info(f"STK Push initiated: {result}")
    return result


def parse_callback(callback_body: dict) -> dict:
    """
    Parse the Daraja STK callback payload.

    Daraja sends:
    {
      "Body": {
        "stkCallback": {
          "MerchantRequestID": "...",
          "CheckoutRequestID": "...",
          "ResultCode": 0,          ← 0 = success
          "ResultDesc": "Success.",
          "CallbackMetadata": {     ← only present on success
            "Item": [
              {"Name": "Amount", "Value": 1500.0},
              {"Name": "MpesaReceiptNumber", "Value": "OEI2AK4MFU"},
              {"Name": "PhoneNumber", "Value": 254712345678},
              ...
            ]
          }
        }
      }
    }
    """
    stk_callback = callback_body.get("Body", {}).get("stkCallback", {})

    result = {
        "merchant_request_id": stk_callback.get("MerchantRequestID"),
        "checkout_request_id": stk_callback.get("CheckoutRequestID"),
        "result_code": stk_callback.get("ResultCode"),
        "result_desc": stk_callback.get("ResultDesc"),
        "success": stk_callback.get("ResultCode") == 0,
        "amount": None,
        "receipt_number": None,
        "phone_number": None,
        "transaction_date": None,
    }

    if result["success"]:
        items = stk_callback.get("CallbackMetadata", {}).get("Item", [])
        meta = {item["Name"]: item.get("Value") for item in items}
        result["amount"] = meta.get("Amount")
        result["receipt_number"] = meta.get("MpesaReceiptNumber")
        result["phone_number"] = str(meta.get("PhoneNumber"))
        result["transaction_date"] = meta.get("TransactionDate")

    return result


async def query_stk_status(checkout_request_id: str) -> dict:
    """
    Query the status of an STK push (for polling / timeout recovery).
    """
    token = await get_access_token()
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = _generate_password(timestamp)

    payload = {
        "BusinessShortCode": settings.MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.MPESA_BASE_URL}/mpesa/stkpushquery/v1/query",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        response.raise_for_status()

    return response.json()
