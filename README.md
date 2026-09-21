# TiketiKE — Web 2.5 Event Ticketing Platform

> **M-Pesa payments. NFT-backed tickets. Screenshot-proof dynamic QR codes. Fully offline gate validation.**

Built for the Kenyan market. Solves ticket counterfeiting, scalping, and unreliable venue internet — without forcing users to touch crypto.

### What's real vs. what's a mock right now

The **backend** (`app/`) is a real FastAPI service: phone-based auth, event
creation/listing, M-Pesa STK push purchase, TOTP-based dynamic QR tickets,
and gate scanning are all implemented and covered by a real, passing test
suite. There is **no smart contract anywhere in this repository** — NFT
minting is an explicit stub, and 8 of the schema's 14 tables (organizer
accounts, gate-scanner devices, resale/transfers, price-cap history,
attendance log, audit log, notifications) have no routes at all yet.

The **frontend** (`frontend/`) is five fully built UI surfaces (Attendee,
Seller/resale, Organiser Console, Scanner, Platform Admin), but it runs
against an **in-browser mock API by default** (`VITE_USE_MOCK`, defaults
`true`). Only the original Attendee purchase→ticket→gate-scan journey has
a real backend-connected implementation (`frontend/src/live/liveApi.js`);
the other ~85% of that file is unimplemented stubs, so the Seller,
Organiser, Scanner, and Admin surfaces only work against the mock today.

See `STATUS.md` at the repo root for a full, evidence-tagged audit of
exactly what's implemented, stubbed, or missing.

---

## How It Works

```
User buys ticket          Backend mints NFT         Gate scans QR
via M-Pesa     ───────►   to custodial wallet  ───►  against local
(no crypto UX)            (anti-scalping rules)       mesh server
                                                       (no internet)
```

1. **Purchase** — user pays via M-Pesa STK push on any phone
2. **Mint** — backend mints an NFT with hardcoded resale rules (Phase 2)
3. **Deliver** — ticket app stores a TOTP secret seed and generates a new QR code every 30 seconds
4. **Validate** — bouncers scan QR against a local Wi-Fi server — no cell signal needed

---

## Project Structure

```
tiketi/
├── app/
│   ├── api/routes/
│   │   ├── auth.py          # Phone OTP login → JWT
│   │   ├── events.py        # Create/list events
│   │   ├── payments.py      # M-Pesa STK push + callback
│   │   ├── tickets.py       # View tickets, get TOTP seed, get QR image
│   │   └── gate.py          # Bouncer scan endpoint + pre-event sync (auth required)
│   ├── core/
│   │   ├── config.py        # Pydantic settings (reads .env)
│   │   └── dependencies.py  # FastAPI auth dependency
│   ├── db/
│   │   └── session.py       # SQLAlchemy engine + session
│   ├── models/
│   │   └── models.py        # 14-table schema — only 6 tables have routes today
│   ├── schemas/
│   │   └── schemas.py       # Pydantic request/response schemas
│   ├── services/
│   │   ├── mpesa.py         # Daraja API: token, STK push, callback parsing
│   │   ├── totp_service.py  # TOTP secret gen, OTP verify, QR image gen
│   │   └── auth_service.py  # OTP store, JWT issue, user creation
│   ├── main.py              # FastAPI app + router registration
│   └── worker.py            # Celery: mint_ticket_nft (stub — no contract exists)
├── migrations/              # Alembic migrations — the only schema authority
│   └── versions/
├── tests/
│   ├── test_api.py          # Full end-to-end flow: auth→purchase→callback→scan
│   └── test_totp.py         # TOTP unit tests
├── frontend/                 # React 19 + Vite SPA — 5 UI surfaces, mock API by default
│   └── src/
│       ├── pages/            # attendee/, seller/, organiser/, scanner/, admin/
│       ├── shells/            # per-surface nav/layout shells
│       ├── components/ui/    # shared component library
│       ├── mock/mockApi.js   # the in-browser backend every surface runs against
│       └── live/liveApi.js   # real-backend client — mostly unimplemented stubs
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/your-org/tiketi.git
cd tiketi
cp .env.example .env
# Edit .env — add your Daraja sandbox keys
```

### 2. Run with Docker Compose

```bash
docker compose up
```

API available at: `http://localhost:8000`
Interactive docs: `http://localhost:8000/docs`

### 3. Run locally (without Docker)

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Apply database migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

---

## API Flow

### Authentication (phone-based, no passwords)

```bash
# 1. Request OTP (sent via SMS, returned in dev mode)
POST /api/v1/auth/request-otp
{ "phone_number": "0712345678" }

# 2. Verify OTP → receive JWT
POST /api/v1/auth/verify-otp
{ "phone_number": "0712345678", "otp_code": "482910" }
→ { "access_token": "eyJ..." }
```

### Purchase a Ticket

```bash
# Triggers M-Pesa STK push to user's phone
POST /api/v1/payments/purchase
Authorization: Bearer <token>
{ "event_id": "uuid", "phone_number": "0712345678" }
→ { "ticket_id": "...", "checkout_request_id": "..." }

# Poll until payment confirmed
GET /api/v1/payments/{payment_id}/status
→ { "status": "success", "mpesa_receipt_number": "OEI2AK4MFU" }
```

### Get Your Ticket QR

```bash
# Get TOTP secret (ticket app calls this once, stores locally)
GET /api/v1/tickets/{ticket_id}/seed
→ { "totp_secret": "BASE32SECRET", "event_title": "...", ... }

# Get current QR code as PNG (refreshes every 30s)
GET /api/v1/tickets/{ticket_id}/qr.png
```

### Gate Scanning

```bash
# Validate a scanned QR payload
POST /api/v1/gate/scan
{ "qr_payload": "TIKETI:<ticket_id>:<otp>", "scanner_id": "device-001" }
→ { "valid": true, "event_title": "...", "owner_phone": "****5678" }

# Pre-event sync (local server downloads all ticket secrets before the event)
# Requires a JWT belonging to an organizer-member of this event or an
# account linked to a GateScanner device registered for it — otherwise 403.
GET /api/v1/gate/sync-event/{event_id}
Authorization: Bearer <token>
→ { "tickets": [{"id": "...", "totp_secret": "..."}], ... }
```

---

## M-Pesa Setup (Daraja Sandbox)

1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an app → copy **Consumer Key** and **Consumer Secret**
3. Go to **Lipa Na Mpesa** → copy the **Passkey**
4. Set `MPESA_ENV=sandbox` and use shortcode `174379` for testing
5. For the callback URL in local dev, use [ngrok](https://ngrok.com):
   ```bash
   ngrok http 8000
   # Use the https URL: https://xxxx.ngrok.io/api/v1/payments/mpesa/callback
   ```

---

## Running Tests

```bash
pytest tests/ -v
```

The test suite covers the full flow end-to-end using an in-memory SQLite DB and a mocked STK push:

- Phone OTP auth → JWT issuance
- Event creation
- Ticket purchase → M-Pesa callback simulation → ticket activation
- TOTP seed retrieval
- QR code generation (PNG validation)
- Gate scan → USED marking → double-scan rejection

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| **1** | 🟡 **Partial** | Core flow works (auth, events, M-Pesa purchase, TOTP QR, gate scan) — but only 6 of the schema's 14 tables have routes; organizer accounts, gate-scanner registration, resale/transfers, and audit/notification tables are still unwired |
| **1.5** | ✅ Done | Frontend: 5 full UI surfaces built (`frontend/`), currently mock-API only — see "What's real vs. what's a mock" above |
| **2** | 🟡 **Partial** | `contracts/TiketiNFT.sol` (ERC-721 + ERC-2981) is written, tested (29 passing), and verified end-to-end against a local chain. Backend minting (`app/services/web3_service.py`) is wired in. **Not yet deployed to Base Sepolia** — needs a funded wallet + RPC, see `contracts/README` below |
| **3** | 🔜 Planned | Flutter ticket viewer app, Android scanner app |
| **4** | 🔜 Planned | Local Wi-Fi mesh server, offline dry-run testing, pilot event |

### Blockchain (contracts/)

`contracts/` is a self-contained Hardhat project — see `contracts/contracts/TiketiNFT.sol`
for the contract and `contracts/test/TiketiNFT.test.js` for its test suite
(`cd contracts && npm test`). `contracts/scripts/deploy.js` deploys it and
prints the `NFT_CONTRACT_ADDRESS` line to add to this repo's `.env`.

Once a contract is deployed, set these three in `.env` (all empty/unset by
default — the backend runs fine without them, minting just stays a logged
no-op):

```
BLOCKCHAIN_RPC_URL=      # e.g. a Base Sepolia RPC endpoint
NFT_CONTRACT_ADDRESS=    # from the deploy script's output
MINTER_PRIVATE_KEY=      # the backend's own relayer wallet — never the deployer's
```

Then start the Celery worker **with the blockchain queue included** — this
is easy to get wrong and silently mint nothing:

```bash
celery -A app.worker worker --loglevel=info -Q celery,blockchain
```

Tickets mint to that relayer wallet (custodial), not the buyer's own
address — see the docstring in `app/services/web3_service.py` for why.
Real self-custody happens only if a user calls the contract's
`claimTicket` (the frontend's "Claim to wallet" flow) — that side isn't
wired into the backend yet, only minting is.

---

## Security Notes

- **TOTP secrets** are stored in the database. In production, encrypt them at rest using a KMS (e.g. AWS KMS, Google Cloud KMS)
- **OTP store** is currently in-memory. In production, move to Redis with TTL
- **Gate sync endpoint** (`/gate/sync-event/`) now requires a JWT and checks the caller is an organizer-member of the event or a registered gate-scanner device for it (403 otherwise). No route yet creates those `OrganizerMember`/`GateScanner` rows, so in practice this only grants access via a directly-inserted `GateScanner` row today — registration endpoints for those are still Phase 2 work
- The **M-Pesa callback** endpoint has no auth by design (Daraja requirement) — validate `checkout_request_id` to prevent spoofing
- `SECRET_KEY` and `MPESA_CALLBACK_URL` are required env vars with no default — the app refuses to start if either is unset, rather than silently running with an insecure placeholder. Rotate `SECRET_KEY` and never commit it — use environment variables or a secrets manager
- SMS delivery (Africa's Talking) has been removed entirely — OTPs are logged to console only. Add a real SMS provider before this goes anywhere near production users

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI + Uvicorn |
| Frontend | React 19 + Vite, react-router-dom, Tailwind — mock API by default |
| Database | PostgreSQL (SQLite for dev) |
| ORM | SQLAlchemy 2.0 + Alembic |
| Payments | Safaricom Daraja (M-Pesa) |
| Dynamic QR | PyOTP (TOTP) + qrcode |
| Auth | Phone OTP + JWT (python-jose) |
| SMS | Not implemented — OTP is logged to console only |
| Task Queue | Celery + Redis |
| Containers | Docker + Docker Compose |
| Phase 2 | Solidity + web3.py (Polygon/Base) |
| Phase 3 | Flutter (iOS/Android) |
