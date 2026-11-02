"""
Blockchain integration for ticket minting on Base Sepolia.

Talks to the deployed TiketiNFT contract (see ../../contracts/ at the repo
root — the Solidity source, tests, and deploy script all live there).

Every function here requires settings.BLOCKCHAIN_CONFIGURED (all three of
BLOCKCHAIN_RPC_URL, NFT_CONTRACT_ADDRESS, MINTER_PRIVATE_KEY set) and raises
RuntimeError otherwise — callers (app/worker.py's mint_ticket_nft task) are
responsible for treating that as "blockchain not set up yet" rather than a
real failure, so the rest of the platform keeps working with no blockchain
configured at all.

Tickets are minted to the platform's own minter/relayer wallet — a
custodial holding address, not the buyer's own wallet. Genuine self-custody
happens later and only if the user explicitly claims the ticket out via the
contract's claimTicket function (the frontend's existing "Claim to wallet"
flow). This mirrors the custodial-wallet pattern already used everywhere
else in this project rather than generating and storing a private key per
user, which this codebase has no infrastructure for and which raises
security questions well beyond this integration's scope.

Contract versions: new tickets are minted on NFT_CONTRACT_ADDRESS (the
current TiketiNFT, with an on-chain resale floor as well as a cap).
Tickets minted before it was deployed stay on the contract they were
minted on: Ticket.nft_contract_address, or NFT_LEGACY_CONTRACT_ADDRESS when
that's empty (tickets from before the column existed). Every call below
takes the ticket's own contract address, and that older contract is read
with its own ABI (abi/TiketiNFT.v1.json: no floor).
"""
import json
import logging
import re
import threading
from pathlib import Path
from functools import lru_cache

from web3 import Web3
from web3.exceptions import ContractLogicError
from eth_account import Account

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_ABI_DIR = Path(__file__).parent / "abi"


@lru_cache
def _load_abi(name: str = "TiketiNFT.json"):
    with open(_ABI_DIR / name) as f:
        return json.load(f)


@lru_cache
def _get_web3() -> Web3:
    return Web3(Web3.HTTPProvider(settings.BLOCKCHAIN_RPC_URL))


def _is_current(address: str | None) -> bool:
    return not address or address.lower() == settings.NFT_CONTRACT_ADDRESS.lower()


def ticket_contract_address(ticket) -> str:
    """The contract this ticket was minted on (see the module docstring)."""
    return ticket.nft_contract_address or settings.NFT_LEGACY_CONTRACT_ADDRESS or settings.NFT_CONTRACT_ADDRESS


def has_onchain_floor(address: str | None) -> bool:
    """Whether the contract at this address enforces a resale floor."""
    return _is_current(address)


@lru_cache
def _get_contract(address: str | None = None):
    """The contract at `address` (default: the current one), with the ABI
    of its version."""
    w3 = _get_web3()
    current = _is_current(address)
    return w3.eth.contract(
        address=Web3.to_checksum_address(settings.NFT_CONTRACT_ADDRESS if current else address),
        abi=_load_abi("TiketiNFT.json" if current else "TiketiNFT.v1.json"),
    )


def _require_configured():
    if not settings.BLOCKCHAIN_CONFIGURED:
        raise RuntimeError(
            "Blockchain not configured — set BLOCKCHAIN_RPC_URL, "
            "NFT_CONTRACT_ADDRESS, and MINTER_PRIVATE_KEY to enable minting."
        )


class ContractRevertError(Exception):
    """
    The chain itself rejected the call — as opposed to a RuntimeError from
    this module's own preconditions (e.g. blockchain not configured). Carries
    the exact on-chain revert message so a route can surface it to the user
    verbatim, e.g. "TiketiNFT: price exceeds resale cap" — that message IS
    the anti-scalping enforcement; see resale.py's listing endpoint.
    """


_REVERT_REASON_QUOTED = re.compile(r"reverted with reason string '([^']*)'")


def _revert_message(exc: ContractLogicError) -> str:
    """
    Extract just the contract's own require() string from web3.py's
    exception, whatever wrapper text the connected node puts around it.

    Confirmed empirically (not assumed) that node wrapper text varies: a
    local Hardhat node wraps it as "execution reverted: Error: VM Exception
    while processing transaction: reverted with reason string 'X'", Base
    Sepolia's real RPC returns the plainer "execution reverted: X" this
    originally (wrongly) assumed was universal. Handles both: regex out the
    quoted reason if that wrapper is present, else fall back to stripping a
    plain "execution reverted: " prefix.

    Reads exc.args[0], not str(exc): when a ContractLogicError carries a
    `data` argument too, str(exc) renders the whole (message, data) tuple
    as text — confirmed by an actual 400 response once showing that raw
    tuple repr to a caller instead of the clean message. args[0] is always
    just the message, regardless of how many other args the exception has.
    """
    msg = exc.args[0] if exc.args else str(exc)
    match = _REVERT_REASON_QUOTED.search(msg)
    if match:
        return match.group(1)
    prefix = "execution reverted: "
    if msg.startswith(prefix):
        return msg[len(prefix):]
    return msg


def _uuid_to_uint256(value: str) -> int:
    """
    On-chain event/tier ids are uint256; off-chain they're UUID strings.
    Deterministically map one to the other via keccak256 — this is an
    opaque on-chain reference tag, not used in any on-chain business logic,
    so a hash is a fine (and collision-safe) substitute for a real integer id.
    """
    return int.from_bytes(Web3.keccak(text=str(value)), "big")


# Last nonce this process broadcast from the minter wallet. Back-to-back
# transactions (a multi-ticket purchase queues one mint per ticket) used to
# reuse a nonce: the public Base Sepolia RPC is load-balanced, so the count
# fetched for the second tx could come from a node that hadn't seen the
# first yet -> "nonce too low", costing a 30s Celery retry each time (and
# with max_retries=3, a busy burst could exhaust them). Never going below
# our own last-used nonce closes that within this worker process.
_nonce_lock = threading.Lock()
_last_nonce: int | None = None


def _send_transaction(fn):
    """Build, sign, and send a transaction from the minter wallet; block for the receipt."""
    global _last_nonce
    w3 = _get_web3()
    account = Account.from_key(settings.MINTER_PRIVATE_KEY)
    with _nonce_lock:
        nonce = w3.eth.get_transaction_count(account.address, "pending")
        if _last_nonce is not None and nonce <= _last_nonce:
            nonce = _last_nonce + 1
        tx = fn.build_transaction({"from": account.address, "nonce": nonce})
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        _last_nonce = nonce
    try:
        return w3.eth.wait_for_transaction_receipt(tx_hash)
    except Exception:
        # The tx may have been dropped; don't keep building on a nonce the
        # chain may never see — re-sync from the node on the next send.
        with _nonce_lock:
            _last_nonce = None
        raise


def mint_ticket_onchain(
    event_id: str,
    tier_id: str,
    face_price_kes: int,
    resale_floor_bps: int,
    resale_cap_bps: int,
    royalty_bps: int,
) -> tuple[int, str]:
    """
    Mint a ticket NFT on the current contract. Returns (token_id, tx_hash).
    Raises on any failure — the caller decides what to do (the Celery task
    lets it raise, so Celery's own retry policy on mint_ticket_nft applies).
    """
    _require_configured()
    contract = _get_contract()
    account = Account.from_key(settings.MINTER_PRIVATE_KEY)

    fn = contract.functions.mintTicket(
        account.address,
        _uuid_to_uint256(event_id),
        _uuid_to_uint256(tier_id),
        int(face_price_kes),
        int(resale_floor_bps),
        int(resale_cap_bps),
        int(royalty_bps),
    )
    receipt = _send_transaction(fn)

    minted = contract.events.TicketMinted().process_receipt(receipt)
    if not minted:
        raise RuntimeError("mintTicket transaction mined but no TicketMinted event found in the receipt")

    token_id = minted[0]["args"]["tokenId"]
    tx_hash = receipt["transactionHash"].hex()
    logger.info(f"Minted ticket NFT token_id={token_id} tx={tx_hash}")
    return token_id, tx_hash


def mark_used_onchain(token_id: int, contract_address: str | None = None) -> str:
    """Mark a token used on-chain. Returns the tx hash. Raises on failure."""
    _require_configured()
    contract = _get_contract(contract_address)
    fn = contract.functions.markUsed(token_id)
    receipt = _send_transaction(fn)
    return receipt["transactionHash"].hex()


def list_for_resale_onchain(token_id: int, price_kes: int, contract_address: str | None = None) -> str:
    """
    List a custodial ticket for resale. Returns the tx hash on success.

    Raises ContractRevertError if the chain rejects the price — most
    importantly when it exceeds this ticket's on-chain resale cap. That
    revert IS the anti-scalping enforcement (Work Order 02's central rule):
    this function must never pre-validate the price itself and skip the
    call, only relay whatever the chain decides. The current contract also
    rejects a price below the ticket's resale floor.

    Simulates the call first (a free eth_call, no gas spent) so a reverting
    price is caught with its exact message before any real transaction is
    sent, rather than only after paying to find out.
    """
    _require_configured()
    contract = _get_contract(contract_address)
    account = Account.from_key(settings.MINTER_PRIVATE_KEY)
    fn = contract.functions.listForResale(int(token_id), int(price_kes))

    try:
        fn.call({"from": account.address})
    except ContractLogicError as e:
        raise ContractRevertError(_revert_message(e)) from e

    receipt = _send_transaction(fn)
    return receipt["transactionHash"].hex()


def settle_custodial_resale_onchain(token_id: int, contract_address: str | None = None) -> str:
    """
    Settle a resale that was paid for off-chain in KES. Returns the tx hash.
    Raises on failure (including ContractRevertError if, e.g., the listing
    was somehow already cleared) — the caller (the Celery settlement task)
    is responsible for retrying or marking the transfer settlement_failed.
    """
    _require_configured()
    contract = _get_contract(contract_address)
    fn = contract.functions.settleCustodialResale(int(token_id))
    try:
        receipt = _send_transaction(fn)
    except ContractLogicError as e:
        raise ContractRevertError(_revert_message(e)) from e
    return receipt["transactionHash"].hex()


def custodian_address() -> str:
    """The platform wallet that holds every unclaimed ticket NFT (it mints them)."""
    _require_configured()
    return Account.from_key(settings.MINTER_PRIVATE_KEY).address


def read_ticket_onchain(token_id: int, mint_tx_hash: str | None = None, contract_address: str | None = None) -> dict:
    """
    Read a ticket straight from the contract — no database involved — so a
    holder can check ChainTix's records against the chain itself. Raises
    ContractRevertError if the token doesn't exist.
    """
    _require_configured()
    w3 = _get_web3()
    contract = _get_contract(contract_address)
    try:
        owner = contract.functions.ownerOf(int(token_id)).call()
        meta = contract.functions.ticketMeta(int(token_id)).call()
        if has_onchain_floor(contract_address):
            event_ref, tier_ref, face_price_kes, resale_floor_bps, resale_cap_bps, used, claimed = meta
        else:
            event_ref, tier_ref, face_price_kes, resale_cap_bps, used, claimed = meta
            resale_floor_bps = None
        listed_price_kes = contract.functions.listingPriceKes(int(token_id)).call()
        _, royalty = contract.functions.royaltyInfo(int(token_id), 10_000).call()
    except ContractLogicError as exc:
        raise ContractRevertError(_revert_message(exc)) from exc

    minted_block = minted_at = None
    if mint_tx_hash:
        try:
            receipt = w3.eth.get_transaction_receipt(mint_tx_hash)
            minted_block = receipt["blockNumber"]
            minted_at = w3.eth.get_block(minted_block)["timestamp"]
        except Exception:  # an RPC node that's pruned or lagging: the rest still stands
            logger.warning(f"Couldn't fetch mint receipt {mint_tx_hash}", exc_info=True)

    return {
        "owner": owner,
        "event_ref": event_ref,
        "tier_ref": tier_ref,
        "face_price_kes": face_price_kes,
        "resale_floor_bps": resale_floor_bps,  # None: this contract has no floor
        "resale_cap_bps": resale_cap_bps,
        "royalty_bps": royalty,
        "used": used,
        "claimed": claimed,
        "listed_price_kes": listed_price_kes,
        "minted_block": minted_block,
        "minted_at": minted_at,
    }


def chain_ref(value: str) -> int:
    """The uint256 an off-chain id is recorded as on-chain (see _uuid_to_uint256)."""
    return _uuid_to_uint256(value)


def explorer_url(kind: str, value: str | None) -> str | None:
    """A block-explorer link: kind is "tx", "address" or "token"."""
    return f"{settings.BLOCKCHAIN_EXPLORER_URL.rstrip('/')}/{kind}/{value}" if value else None


def read_settlement_onchain(tx_hash: str, contract_address: str | None = None) -> dict | None:
    """
    Decode a resale settlement transaction straight from the chain: which
    token it settled and at what KES price (CustodialResaleSettled), and
    when. None if the transaction has no such event from this contract.
    """
    _require_configured()
    w3 = _get_web3()
    contract = _get_contract(contract_address)
    receipt = w3.eth.get_transaction_receipt(tx_hash)
    events = contract.events.CustodialResaleSettled().process_receipt(receipt)
    if not events:
        return None
    args = events[0]["args"]
    block = w3.eth.get_block(receipt["blockNumber"])
    return {
        "token_id": int(args["tokenId"]),
        "price_kes": int(args["salePriceKes"]),
        "block": receipt["blockNumber"],
        "at": block["timestamp"],
    }
