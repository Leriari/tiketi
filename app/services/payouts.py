"""
Payouts: money ChainTix sends out (the Payout model).

    seller withdrawal ─┐
                       ├─(Daraja on)──→ processing ──→ paid
    organiser request ─→ pending_approval ─(approve)─┘     └→ failed: money back
                              └─(reject)→ rejected: money back

- A seller's withdrawal goes straight to Safaricom. An organiser's waits for
  a finance admin. With no Daraja payout credentials configured, both wait
  for an admin, who pays by hand and records the M-Pesa receipt.
- The amount leaves the balance when the payout is created. A failed or
  rejected payout gives it back.
- Safaricom's result is applied at most once (_claim). It's trusted only
  with this payout's own secret token in its URL and matching IDs and
  amount. Daraja results aren't signed, so the token is what keeps
  anyone else from posting one.
- No answer is never treated as a failure: the payout stays processing
  until Safaricom's result or a Transaction Status check settles it.
"""
import hashlib
import hmac
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.constants import MAX_PAYOUT_KES, payout_charge_kes
from app.models.models import (
    Organizer, OrganizerVerificationStatus, Payout, PayoutStatus, User, WalletTransaction,
    WalletTransactionStatus, WalletTransactionType,
)
from app.services import mpesa

settings = get_settings()
logger = logging.getLogger(__name__)

# Statuses whose amount is out of the recipient's balance.
HELD = (PayoutStatus.PENDING_APPROVAL, PayoutStatus.PROCESSING, PayoutStatus.PAID)
# Daraja's smallest B2C/B2B amount.
MIN_SEND_KES = 10
CHANNEL_LABEL = {"mpesa": "M-Pesa", "paybill": "Paybill", "till": "Till"}


class PayoutError(Exception):
    """A payout that can't be made as asked; the message is for the user."""


def _now() -> datetime:
    return datetime.utcnow()


def _mask(number: str | None) -> str:
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    return "*" * max(len(digits) - 3, 0) + digits[-3:]


def describe_destination(channel: str, destination: str, account: str | None = None,
                         label: str | None = None, masked: bool = True) -> str:
    """"M-Pesa *********678", "Equity Bank (paybill 247247) · account 0123…"."""
    if channel == "mpesa":
        return f"M-Pesa {_mask(destination) if masked else destination}"
    if channel == "till":
        return f"{label + ' · ' if label else ''}Till {destination}"
    name = f"{label} (paybill {destination})" if label else f"Paybill {destination}"
    return f"{name} · account {_mask(account) if masked else account}" if account else name


def quote(amount_kes: float) -> dict:
    charge = payout_charge_kes(amount_kes)
    return {"amount": amount_kes, "charge": charge, "net": amount_kes - charge}


def check_amount(amount_kes: float, available_kes: float, min_payout_kes: float) -> None:
    if amount_kes != int(amount_kes):
        raise PayoutError("Enter a whole number of shillings.")
    if amount_kes < min_payout_kes:
        raise PayoutError(f"The minimum is KES {int(min_payout_kes):,}.")
    if amount_kes > MAX_PAYOUT_KES:
        raise PayoutError(f"M-Pesa sends at most KES {int(MAX_PAYOUT_KES):,} at a time.")
    if amount_kes > available_kes + 1e-9:
        raise PayoutError("That's more than your available balance.")
    if amount_kes - payout_charge_kes(amount_kes) < MIN_SEND_KES:
        raise PayoutError("That's too little to send after the M-Pesa charge.")


def organiser_block_reason(org: Organizer, *, check_destination: bool = True) -> str | None:
    """Why this organisation can't be paid right now, or None."""
    if org.suspended_at:
        return "This organisation is suspended, so it can't be paid out."
    if org.verification_status != OrganizerVerificationStatus.VERIFIED:
        return "ChainTix pays out to verified organisations only. Yours is still being reviewed."
    if not check_destination:
        return None
    if org.payout_method not in CHANNEL_LABEL or not org.payout_destination:
        return "Add where your payouts should go in Payout Details first."
    if org.payout_method == "paybill" and not org.payout_account:
        return "Add the paybill account number in Payout Details first."
    return None


def organiser_totals(db: Session, organizer_id: str) -> dict:
    """KES held by this organisation's payouts: in progress, and paid."""
    rows = db.query(Payout).filter(Payout.organizer_id == organizer_id, Payout.status.in_(HELD)).all()
    return {
        "in_progress": sum(p.amount_kes for p in rows if p.status != PayoutStatus.PAID),
        "paid": sum(p.amount_kes for p in rows if p.status == PayoutStatus.PAID),
    }


# ── Creating payouts ────────────────────────────────────────────────────────

def _first_status() -> PayoutStatus:
    return PayoutStatus.PROCESSING if settings.MPESA_PAYOUTS_CONFIGURED else PayoutStatus.PENDING_APPROVAL


def create_seller_withdrawal(db: Session, user: User, amount_kes: float) -> Payout:
    """A seller's withdrawal to their own M-Pesa number. The caller has
    checked the amount against their balance (check_amount), under a lock
    on the user's row."""
    q = quote(amount_kes)
    txn = WalletTransaction(
        user_id=user.id,
        type=WalletTransactionType.WITHDRAWAL,
        description=f"Withdrawal to M-Pesa {_mask(user.phone_number)}",
        amount_kes=-amount_kes,
        status=WalletTransactionStatus.PENDING,
    )
    db.add(txn)
    db.flush()
    payout = Payout(
        recipient_type="seller", user_id=user.id, wallet_transaction_id=txn.id,
        channel="mpesa", destination=user.phone_number,
        amount_kes=amount_kes, charge_kes=q["charge"], net_kes=q["net"], status=_first_status(),
    )
    db.add(payout)
    db.flush()
    return payout


def create_organiser_payout(db: Session, org: Organizer, requested_by: User, amount_kes: float) -> Payout:
    """An organiser's payout request, to its payout details as they are
    now. Always waits for a finance admin."""
    q = quote(amount_kes)
    payout = Payout(
        recipient_type="organiser", user_id=requested_by.id, organizer_id=org.id,
        channel=org.payout_method, destination=org.payout_destination,
        account_reference=org.payout_account if org.payout_method == "paybill" else None,
        destination_label=org.payout_label,
        amount_kes=amount_kes, charge_kes=q["charge"], net_kes=q["net"], status=PayoutStatus.PENDING_APPROVAL,
    )
    db.add(payout)
    db.flush()
    return payout


# ── Sending ─────────────────────────────────────────────────────────────────

def result_token(payout_id: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"payout:{payout_id}".encode(), hashlib.sha256).hexdigest()[:32]


def token_ok(payout_id: str, token: str) -> bool:
    return hmac.compare_digest(result_token(payout_id), token or "")


def _url(kind: str, payout: Payout) -> str:
    return f"{settings.PAYOUT_RESULT_BASE_URL}/{kind}/{payout.id}/{result_token(payout.id)}"


def _claim(db: Session, payout: Payout, from_status: PayoutStatus, to_status: PayoutStatus) -> bool:
    """Atomically move a payout out of from_status. A result, a status
    check and an admin can all act at once; only one UPDATE matches."""
    claimed = (
        db.query(Payout)
        .filter(Payout.id == payout.id, Payout.status == from_status)
        .update({Payout.status: to_status}, synchronize_session=False)
    )
    db.flush()
    db.refresh(payout)
    return claimed == 1


def _wallet_txn(db: Session, payout: Payout) -> WalletTransaction | None:
    return db.get(WalletTransaction, payout.wallet_transaction_id) if payout.wallet_transaction_id else None


def _mark_paid(db: Session, payout: Payout, receipt: str | None, recipient_name: str | None = None) -> None:
    payout.mpesa_receipt = (receipt or "")[:20] or None
    payout.recipient_name = recipient_name
    payout.completed_at = _now()
    txn = _wallet_txn(db, payout)
    if txn:
        txn.status = WalletTransactionStatus.SUCCESS
        if payout.mpesa_receipt:
            txn.description = f"{txn.description} · {payout.mpesa_receipt}"[:255]


def _give_back(db: Session, payout: Payout, reason: str) -> None:
    """After a payout is claimed into FAILED or REJECTED: its amount goes
    back into the balance."""
    payout.result_desc = reason
    payout.completed_at = _now()
    txn = _wallet_txn(db, payout)
    if txn:
        txn.status = WalletTransactionStatus.FAILED


async def send(db: Session, payout: Payout) -> None:
    """Send a payout that is already PROCESSING to Safaricom. Commits."""
    remarks = "ChainTix seller payout" if payout.recipient_type == "seller" else "ChainTix organiser payout"
    if payout.channel == "mpesa":
        payout.originator_conversation_id = payout.id  # ChainTix's own: Daraja refuses a duplicate
    payout.sent_at = _now()
    db.commit()
    try:
        if payout.channel == "mpesa":
            response = await mpesa.b2c_payment(
                originator_conversation_id=payout.id, phone_number=payout.destination, amount=int(payout.net_kes),
                remarks=remarks, result_url=_url("result", payout), timeout_url=_url("timeout", payout),
            )
        else:
            response = await mpesa.b2b_payment(
                till=payout.channel == "till", party_b=payout.destination, account_reference=payout.account_reference,
                amount=int(payout.net_kes), remarks=remarks,
                result_url=_url("result", payout), timeout_url=_url("timeout", payout),
            )
    except mpesa.PayoutRequestError as e:
        logger.warning(f"Payout {payout.id} refused by Daraja: {e}")
        if _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.FAILED):
            _give_back(db, payout, f"M-Pesa didn't accept the payout: {e}")
        db.commit()
        return
    except mpesa.PayoutRequestUncertain as e:
        logger.error(f"Payout {payout.id}: no clear answer from Daraja ({e}); left processing")
        payout.result_desc = f"No clear answer from M-Pesa ({e}). Check its status before doing anything else."
        db.commit()
        return

    payout.originator_conversation_id = response.get("OriginatorConversationID") or payout.originator_conversation_id
    payout.conversation_id = response.get("ConversationID")
    payout.result_desc = None
    db.commit()


async def approve(db: Session, payout: Payout, admin: User) -> None:
    if not settings.MPESA_PAYOUTS_CONFIGURED:
        raise PayoutError("M-Pesa payouts aren't set up on this server. Pay it by hand, then mark it paid.")
    if payout.organizer:
        # The destination was copied in at request time; the organisation
        # must still be verified and not suspended.
        reason = organiser_block_reason(payout.organizer, check_destination=False)
        if reason:
            raise PayoutError(reason)
    if not _claim(db, payout, PayoutStatus.PENDING_APPROVAL, PayoutStatus.PROCESSING):
        raise PayoutError("This payout isn't waiting for approval any more.")
    payout.reviewed_by = admin.id
    payout.reviewed_at = _now()
    await send(db, payout)


# ── Safaricom's answers ─────────────────────────────────────────────────────

def _matches(payout: Payout, parsed: dict) -> bool:
    """The result is about this payout: whichever IDs both sides have agree."""
    pairs = ((payout.conversation_id, parsed["conversation_id"]),
             (payout.originator_conversation_id, parsed["originator_conversation_id"]))
    return any(ours and theirs for ours, theirs in pairs) and all(
        ours == theirs for ours, theirs in pairs if ours and theirs
    )


def _amount(value) -> float | None:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def apply_result(db: Session, payout: Payout, body: dict) -> None:
    """A B2C or B2B result posted to this payout's ResultURL. Commits."""
    parsed = mpesa.parse_result(body)
    if not _matches(payout, parsed):
        logger.error(f"Payout {payout.id}: result for another request ignored: {parsed}")
        return
    if payout.status != PayoutStatus.PROCESSING:
        logger.info(f"Payout {payout.id} already {payout.status.value}; repeated result ignored")
        return
    payout.result_code = parsed["result_code"]
    payout.result_payload = body
    params = parsed["params"]

    if parsed["result_code"] != "0":
        if _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.FAILED):
            _give_back(db, payout, parsed["result_desc"] or "M-Pesa couldn't complete the payout.")
        db.commit()
        return

    sent = _amount(params.get("TransactionAmount", params.get("Amount")))
    if sent is not None and abs(sent - payout.net_kes) > 0.01:
        logger.error(f"Payout {payout.id}: M-Pesa reports KES {sent}, expected {payout.net_kes}; left for an admin")
        payout.result_desc = f"M-Pesa reports KES {sent:,.0f} sent, not KES {payout.net_kes:,.0f}. Needs checking."
        db.commit()
        return
    if _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.PAID):
        _mark_paid(db, payout, params.get("TransactionReceipt") or parsed["transaction_id"],
                   params.get("ReceiverPartyPublicName"))
        payout.result_desc = parsed["result_desc"]
    db.commit()


async def check_status(db: Session, payout: Payout) -> None:
    """Ask Safaricom what happened to a processing payout; the answer
    arrives at its status URL (apply_status_result). Commits."""
    if not settings.MPESA_PAYOUTS_CONFIGURED:
        raise PayoutError("M-Pesa payouts aren't set up on this server.")
    if payout.status != PayoutStatus.PROCESSING:
        raise PayoutError("Only a payout in progress can be checked.")
    if not (payout.originator_conversation_id or payout.mpesa_receipt):
        raise PayoutError("M-Pesa never confirmed receiving this payout, so there's nothing to look up. "
                          "Check the M-Pesa business portal, then mark it paid or failed.")
    try:
        await mpesa.transaction_status(
            originator_conversation_id=payout.originator_conversation_id, transaction_id=payout.mpesa_receipt,
            result_url=_url("status", payout), timeout_url=_url("status-timeout", payout),
        )
    except (mpesa.PayoutRequestError, mpesa.PayoutRequestUncertain) as e:
        raise PayoutError(f"M-Pesa didn't take the status check: {e}") from e
    payout.result_desc = f"Asked M-Pesa for this payout's status at {_now():%H:%M} UTC; waiting for its answer."
    db.commit()


def apply_status_result(db: Session, payout: Payout, body: dict) -> None:
    """A Transaction Status answer. Settles the payout only when M-Pesa
    says plainly that it completed or failed. Commits."""
    parsed = mpesa.parse_result(body)
    params = parsed["params"]
    if payout.status != PayoutStatus.PROCESSING:
        return
    original = params.get("OriginatorConversationID")
    if original and payout.originator_conversation_id and original != payout.originator_conversation_id:
        logger.error(f"Payout {payout.id}: status answer about another transaction ignored: {parsed}")
        return
    if parsed["result_code"] != "0":
        payout.result_desc = f"M-Pesa couldn't answer the status check: {parsed['result_desc']}"
        db.commit()
        return

    state = str(params.get("TransactionStatus") or "")
    sent = _amount(params.get("Amount"))
    if state.lower() == "completed" and (sent is None or abs(sent - payout.net_kes) <= 0.01):
        if _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.PAID):
            _mark_paid(db, payout, params.get("ReceiptNo"), params.get("CreditPartyName"))
            payout.result_desc = "Confirmed by an M-Pesa status check."
            payout.result_payload = body
    elif state.lower() in ("failed", "declined", "cancelled", "expired", "reversed"):
        if _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.FAILED):
            _give_back(db, payout, f"M-Pesa status check: {state}.")
            payout.result_payload = body
    else:
        payout.result_desc = f"M-Pesa status check says \"{state or parsed['result_desc']}\". Needs checking."
    db.commit()


# ── Admin decisions ─────────────────────────────────────────────────────────

def reject(db: Session, payout: Payout, admin: User, reason: str) -> None:
    if not _claim(db, payout, PayoutStatus.PENDING_APPROVAL, PayoutStatus.REJECTED):
        raise PayoutError("This payout isn't waiting for approval any more.")
    payout.reviewed_by, payout.reviewed_at, payout.review_note = admin.id, _now(), reason
    _give_back(db, payout, reason)


def mark_paid_manually(db: Session, payout: Payout, admin: User, receipt: str) -> None:
    """The admin paid it outside Daraja (or confirmed it in the M-Pesa
    business portal) and records the receipt."""
    previous = payout.status
    if previous not in (PayoutStatus.PENDING_APPROVAL, PayoutStatus.PROCESSING) or not _claim(
        db, payout, previous, PayoutStatus.PAID
    ):
        raise PayoutError("Only a payout waiting for approval or in progress can be marked paid.")
    payout.manual = previous == PayoutStatus.PENDING_APPROVAL
    payout.reviewed_by, payout.reviewed_at = admin.id, _now()
    _mark_paid(db, payout, receipt.strip().upper())
    payout.result_desc = "Marked paid by an admin."


def mark_failed(db: Session, payout: Payout, admin: User, reason: str) -> None:
    """For a payout stuck in progress that the admin has confirmed never
    arrived (e.g. in the M-Pesa business portal)."""
    if not _claim(db, payout, PayoutStatus.PROCESSING, PayoutStatus.FAILED):
        raise PayoutError("Only a payout in progress can be marked failed.")
    payout.reviewed_by, payout.reviewed_at, payout.review_note = admin.id, _now(), reason
    _give_back(db, payout, reason)


# ── Output ──────────────────────────────────────────────────────────────────

def serialize(payout: Payout, *, masked: bool = True) -> dict:
    return {
        "id": payout.id,
        "recipient_type": payout.recipient_type,
        "status": payout.status.value,
        "channel": payout.channel,
        "destination": describe_destination(payout.channel, payout.destination, payout.account_reference,
                                            payout.destination_label, masked=masked),
        "amount_kes": payout.amount_kes,
        "charge_kes": payout.charge_kes,
        "net_kes": payout.net_kes,
        "mpesa_receipt": payout.mpesa_receipt,
        "recipient_name": payout.recipient_name,
        "note": payout.review_note or payout.result_desc,
        "manual": payout.manual,
        "created_at": payout.created_at,
        "completed_at": payout.completed_at,
    }
