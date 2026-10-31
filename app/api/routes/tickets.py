import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.models import (
    Attendance, AttendanceStatus, AuditLog, Barcode, BarcodeStatus, GateScanner, Payment, PaymentStatus, Ticket,
    TicketStatus, User,
)
from app.schemas.schemas import TicketOut, TicketSeedResponse, TicketTransferRequest
from app.services.totp_service import (
    generate_qr_image_bytes, generate_totp_secret, seconds_until_next_rotation, build_qr_payload,
)
from app.services.gate_partitioning import assign_gate
from app.core.crypto import encrypt_secret
from app.core.dependencies import get_current_user
from app.core.config import get_settings

router = APIRouter(prefix="/tickets", tags=["Tickets"])
settings = get_settings()
logger = logging.getLogger(__name__)


def _own_ticket(db: Session, ticket_id: str, user: User) -> Ticket:
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.owner_id == user.id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def _explorer(kind: str, value: str | None) -> str | None:
    return f"{settings.BLOCKCHAIN_EXPLORER_URL.rstrip('/')}/{kind}/{value}" if value else None


def _payment_for(db: Session, ticket: Ticket, user: User) -> Payment | None:
    """The current owner's own successful payment for this ticket: the
    original purchase, or the resale purchase they made. None for a gift."""
    return (
        db.query(Payment)
        .filter(Payment.user_id == user.id, Payment.status == PaymentStatus.SUCCESS,
                or_(Payment.ticket_id == ticket.id, Payment.id == ticket.group_payment_id))
        .order_by(Payment.confirmed_at.desc())
        .first()
    )


@router.get("/my", response_model=List[TicketOut])
def get_my_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all tickets owned by the authenticated user, with their event."""
    tickets = (
        db.query(Ticket)
        .filter(Ticket.owner_id == current_user.id)
        .order_by(Ticket.created_at.desc())
        .all()
    )
    return [
        TicketOut.model_validate(t).model_copy(update={
            "status": t.status.value,
            "event_title": t.event.title if t.event else None,
            "event_date": t.event.event_date if t.event else None,
            "venue": t.event.venue if t.event else None,
            "category": t.event.category if t.event else None,
            "image_url": t.event.image_url if t.event else None,
            "tier_name": t.tier.tier_name if t.tier else None,
        })
        for t in tickets
    ]


@router.get("/{ticket_id}/detail")
def get_ticket_detail(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Everything the attendee's Confirmation and ticket pages need in one
    call: event and tier, the ticket's status (and when it was admitted),
    its gate, the payment behind it, and its on-chain record. chain_status
    flips pending -> verified once the mint completes (nft_token_id set);
    the hashes are the real transactions, linked to the block explorer.
    """
    ticket = _own_ticket(db, ticket_id, current_user)
    event = ticket.event
    gates = sorted({
        s.gate_name for s in db.query(GateScanner).filter(GateScanner.event_id == ticket.event_id).all() if s.gate_name
    })
    admitted = db.query(Attendance).filter(
        Attendance.ticket_id == ticket.id, Attendance.status == AttendanceStatus.ADMITTED
    ).order_by(Attendance.scan_time).first()
    payment = _payment_for(db, ticket, current_user)
    return {
        "ticket_id": ticket.id,
        "status": ticket.status.value,
        "admitted_at": ticket.used_at or (admitted.scan_time if admitted else None),
        "event_id": ticket.event_id,
        "event_title": event.title if event else None,
        "category": event.category if event else None,
        "image_url": event.image_url if event else None,
        "venue": event.venue if event else None,
        "event_date": event.event_date if event else None,
        "ends_at": event.ends_at if event else None,
        "tier_name": ticket.tier.tier_name if ticket.tier else None,
        "seat_number": ticket.seat_number,
        "is_complimentary": bool(ticket.is_complimentary),
        # The gate this ticket is partitioned to, once the organiser has
        # enrolled scanner devices at more than one gate.
        "gate_assignment": assign_gate(ticket.id, gates) if len(gates) > 1 else None,
        "payment": {
            "id": payment.id,
            "amount_kes": payment.amount_kes,
            "quantity": payment.quantity or 1,
            "method": payment.method,
            "mpesa_receipt": payment.mpesa_receipt_number,
            "paid_with": payment.paid_with,
            "paid_at": payment.confirmed_at,
        } if payment else None,
        "receipt_email": current_user.email if payment and settings.EMAIL_CONFIGURED else None,
        "chain_status": "verified" if ticket.nft_token_id else "pending",
        "chain": {
            "network": settings.BLOCKCHAIN_NETWORK_NAME,
            "contract_address": settings.NFT_CONTRACT_ADDRESS or None,
            "contract_url": _explorer("address", settings.NFT_CONTRACT_ADDRESS),
            "token_id": ticket.nft_token_id,
            "token_url": (
                f"{settings.BLOCKCHAIN_EXPLORER_URL.rstrip('/')}/token/{settings.NFT_CONTRACT_ADDRESS}?a={ticket.nft_token_id}"
                if ticket.nft_token_id and settings.NFT_CONTRACT_ADDRESS else None
            ),
            "mint_tx_hash": ticket.nft_tx_hash,
            "mint_tx_url": _explorer("tx", ticket.nft_tx_hash),
            "used_tx_hash": ticket.used_tx_hash,
            "used_tx_url": _explorer("tx", ticket.used_tx_hash),
        },
        "nft_token_id": ticket.nft_token_id,
        "nft_tx_hash": ticket.nft_tx_hash,
        # Claiming to a personal wallet isn't offered yet: tickets stay in
        # ChainTix's custodial wallet.
        "self_custodied": False,
        "wallet_address": None,
    }


@router.get("/{ticket_id}/onchain")
def verify_ticket_onchain(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Read this ticket back from the blockchain itself and compare it with
    ChainTix's own records, check by check — so the holder doesn't have to
    take the "Verified" badge on trust.
    """
    from app.services import web3_service

    ticket = _own_ticket(db, ticket_id, current_user)
    if not ticket.nft_token_id:
        raise HTTPException(status_code=409, detail="This ticket is still being minted. Try again in a minute.")
    if not settings.BLOCKCHAIN_CONFIGURED:
        raise HTTPException(status_code=503, detail="This server isn't connected to the blockchain.")
    try:
        chain = web3_service.read_ticket_onchain(ticket.nft_token_id, ticket.nft_tx_hash)
    except web3_service.ContractRevertError as exc:
        raise HTTPException(status_code=502, detail=f"The contract rejected the lookup: {exc}")
    except Exception:
        logger.warning("On-chain lookup failed for ticket %s", ticket.id, exc_info=True)
        raise HTTPException(status_code=503, detail="Couldn't reach the blockchain right now. Try again shortly.")

    tier = ticket.tier
    custodian = web3_service.custodian_address()
    admitted = ticket.status == TicketStatus.USED or db.query(Attendance.id).filter(
        Attendance.ticket_id == ticket.id, Attendance.status == AttendanceStatus.ADMITTED
    ).first() is not None
    checks = [
        {"label": "Token exists on the contract", "pass": True},
        {"label": "Held by ChainTix's custodial wallet for you", "pass": chain["owner"].lower() == custodian.lower()},
        {"label": "Minted for this event", "pass": chain["event_ref"] == web3_service.chain_ref(ticket.event_id)},
        {"label": "Minted for this ticket tier", "pass": bool(tier) and chain["tier_ref"] == web3_service.chain_ref(tier.id)},
        {"label": "Face value matches", "pass": bool(tier) and chain["face_price_kes"] == int(tier.price_kes)},
    ]
    if admitted:
        checks.append({"label": "Admission recorded on-chain", "pass": chain["used"], "pending": not chain["used"]})
    else:
        checks.append({"label": "Not yet used at the gate", "pass": not chain["used"]})
    return {
        "verified_at": datetime.now(timezone.utc),
        "network": settings.BLOCKCHAIN_NETWORK_NAME,
        "token_id": ticket.nft_token_id,
        "owner": chain["owner"],
        "minted_block": chain["minted_block"],
        "minted_at": datetime.fromtimestamp(chain["minted_at"], tz=timezone.utc) if chain["minted_at"] else None,
        "face_price_kes": chain["face_price_kes"],
        "resale_cap_percent": chain["resale_cap_bps"] / 100,
        "royalty_percent": chain["royalty_bps"] / 100,
        "used": chain["used"],
        "listed_price_kes": chain["listed_price_kes"] or None,
        "checks": checks,
        "all_passed": all(c["pass"] or c.get("pending") for c in checks),
    }


@router.post("/{ticket_id}/transfer")
def transfer_ticket(
    ticket_id: str,
    body: TicketTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Give a ticket to another ChainTix account (by phone or email). Free, so
    it's an ownership change rather than a sale: the old QR stops working
    immediately and the recipient gets a fresh credential. The NFT stays in
    the custodial wallet; ownership is ChainTix's off-chain record, as for
    every custodial ticket.
    """
    ticket = _own_ticket(db, ticket_id, current_user)
    if ticket.status == TicketStatus.RESALE:
        raise HTTPException(status_code=400, detail="This ticket is listed for resale. Take it off sale first.")
    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only an unused, active ticket can be transferred.")
    event = ticket.event
    if event and event.event_date <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="This event has started, so its tickets can't be transferred.")

    target = body.recipient
    query = db.query(User).filter(User.is_active.is_(True))
    recipient = (query.filter(User.email == target).first() if "@" in target
                 else query.filter(User.phone_number == target).first())
    if not recipient:
        raise HTTPException(
            status_code=404,
            detail="No ChainTix account uses that number or email. Ask your friend to sign up first, then try again.",
        )
    if recipient.id == current_user.id:
        raise HTTPException(status_code=400, detail="That's your own account.")

    for barcode in ticket.barcodes:
        if barcode.status == BarcodeStatus.ACTIVE:
            barcode.status = BarcodeStatus.REVOKED
    db.add(Barcode(
        ticket_id=ticket.id, event_id=ticket.event_id, owner_id=recipient.id,
        token=encrypt_secret(generate_totp_secret()),
        token_version=max((b.token_version for b in ticket.barcodes), default=0) + 1,
        status=BarcodeStatus.ACTIVE,
    ))
    ticket.owner_id = recipient.id
    log = AuditLog(actor_id=current_user.id, action_type="ticket_transferred", target_id=ticket.id,
                   target_type="ticket", details=f"to={recipient.id}")
    db.add(log)
    db.commit()

    if settings.EMAIL_CONFIGURED and recipient.email:
        from app.worker import send_transfer_notice
        send_transfer_notice.delay(log.id)
    name = recipient.display_name or ("0" + recipient.phone_number[3:] if recipient.phone_number.startswith("254") else recipient.phone_number)
    return {"success": True, "recipient_name": name}


@router.post("/{ticket_id}/receipt")
def resend_receipt(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Email the receipt for this ticket's purchase again."""
    ticket = _own_ticket(db, ticket_id, current_user)
    payment = _payment_for(db, ticket, current_user)
    if not payment:
        raise HTTPException(status_code=404, detail="There's no purchase receipt for this ticket. It was a gift or complimentary.")
    if not settings.EMAIL_CONFIGURED:
        raise HTTPException(status_code=503, detail="Email isn't set up on this server yet.")
    if not current_user.email:
        raise HTTPException(status_code=400, detail="Add an email address to your profile first.")
    from app.worker import send_payment_receipt
    send_payment_receipt.delay(payment.id, force=True)
    return {"success": True, "email": current_user.email}


@router.get("/{ticket_id}/seed", response_model=TicketSeedResponse)
def get_ticket_seed(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the TOTP secret seed for a ticket.
    This is called once by the ticket app on first load — the app
    stores the seed locally and generates QR codes offline from then on.

    Only the ticket owner can access this.
    """
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != TicketStatus.ACTIVE:
        reason = {
            TicketStatus.USED: "This ticket has already been used at the gate.",
            TicketStatus.RESALE: "This ticket is listed for resale, so its QR code is paused.",
        }.get(ticket.status, f"This ticket isn't active (status: {ticket.status.value}).")
        raise HTTPException(status_code=400, detail=reason)

    event = ticket.event

    return TicketSeedResponse(
        ticket_id=ticket.id,
        totp_secret=ticket.totp_secret,
        totp_issuer=settings.TOTP_ISSUER,
        event_title=event.title,
        event_date=event.event_date.strftime("%d %b %Y, %H:%M"),
        venue=event.venue,
        qr_payload=build_qr_payload(ticket.id, ticket.totp_secret),
    )


@router.get("/{ticket_id}/qr.png")
def get_ticket_qr(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the current QR code as a PNG image.
    The client should refresh this every 30 seconds.

    Note: For production, QR generation happens on the client device using
    the stored seed. This endpoint is a fallback for web-based ticket viewing.
    """
    ticket = (
        db.query(Ticket)
        .filter(Ticket.id == ticket_id, Ticket.owner_id == current_user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != TicketStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Ticket is not active")

    qr_bytes = generate_qr_image_bytes(ticket_id, ticket.totp_secret)
    ttl = seconds_until_next_rotation()

    return Response(
        content=qr_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": f"no-cache, max-age={ttl}",
            "X-QR-Expires-In": str(ttl),
        },
    )
