"""
Where Safaricom posts payout outcomes (app/services/payouts.py). Each URL
carries the payout's id and its secret token, so only Safaricom (which was
given the URL) can post a result for it:

  POST /payouts/results/result/{id}/{token}          B2C or B2B result
  POST /payouts/results/timeout/{id}/{token}         timed out in Safaricom's queue
  POST /payouts/results/status/{id}/{token}          Transaction Status answer
  POST /payouts/results/status-timeout/{id}/{token}  that check timed out
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.models import Payout, PayoutStatus
from app.services import payouts as payout_service

router = APIRouter(prefix="/payouts/results", tags=["Payouts"], include_in_schema=False)
logger = logging.getLogger(__name__)

_ACCEPTED = {"ResultCode": 0, "ResultDesc": "Accepted"}


def _payout(db: Session, payout_id: str, token: str) -> Payout:
    if not payout_service.token_ok(payout_id, token):
        raise HTTPException(status_code=403, detail="Invalid token")
    payout = db.get(Payout, payout_id)
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")
    return payout


async def _body(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Expected JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")
    return body


@router.post("/result/{payout_id}/{token}")
async def payout_result(payout_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    payout = _payout(db, payout_id, token)
    body = await _body(request)
    logger.info(f"Payout {payout_id} result: {body}")
    payout_service.apply_result(db, payout, body)
    return _ACCEPTED


@router.post("/timeout/{payout_id}/{token}")
async def payout_timeout(payout_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    """Safaricom didn't process the payout in time. It may still have gone
    through, so the payout stays in progress and its status is checked."""
    payout = _payout(db, payout_id, token)
    logger.warning(f"Payout {payout_id} timed out in Safaricom's queue: {await _body(request)}")
    if payout.status == PayoutStatus.PROCESSING:
        try:
            await payout_service.check_status(db, payout)
        except payout_service.PayoutError as e:
            payout.result_desc = f"M-Pesa timed out on this payout, and checking its status failed: {e}"
            db.commit()
    return _ACCEPTED


@router.post("/status/{payout_id}/{token}")
async def payout_status_result(payout_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    payout = _payout(db, payout_id, token)
    body = await _body(request)
    logger.info(f"Payout {payout_id} status answer: {body}")
    payout_service.apply_status_result(db, payout, body)
    return _ACCEPTED


@router.post("/status-timeout/{payout_id}/{token}")
async def payout_status_timeout(payout_id: str, token: str, request: Request, db: Session = Depends(get_db)):
    payout = _payout(db, payout_id, token)
    await _body(request)
    if payout.status == PayoutStatus.PROCESSING:
        payout.result_desc = "M-Pesa timed out answering the status check. Try again later."
        db.commit()
    return _ACCEPTED
