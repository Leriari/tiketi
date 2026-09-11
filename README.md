# TiketiKE — Web 2.5 Event Ticketing Platform

> **M-Pesa payments. NFT-backed tickets. Screenshot-proof dynamic QR codes. Fully offline gate validation.**

Built for the Kenyan market. Solves ticket counterfeiting, scalping, and unreliable venue internet — without forcing users to touch crypto.

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
│   │   └── gate.py          # Bouncer scan endpoint + pre-event sync
│   ├── core/
│   │   ├── config.py        # Pydantic settings (reads .env)
│   │   └── dependencies.py  # FastAPI auth dependency
│   ├── db/
│   │   └── session.py       # SQLAlchemy engine + session
│   ├── models/
│   │   └── models.py        # User, Event, Ticket, Payment ORM models
│   ├── schemas/
│   │   └── schemas.py       # Pydantic request/response schemas
│   ├── services/
│   │   ├── mpesa.py         # Daraja API: token, STK push, callback parsing
│   │   ├── totp_service.py  # TOTP secret gen, OTP verify, QR image gen
│   │   └── auth_service.py  # OTP store, JWT issue, user creation
│   ├── main.py              # FastAPI app + router registration
│   └── worker.py            # Celery tasks (NFT minting stub for Phase 2)
├── migrations/              # Alembic migrations
│   └── versions/
│       └── *_initial_schema.py
├── tests/
│   ├── test_api.py          # Full end-to-end flow: auth→purchase→callback→scan
│   └── test_totp.py         # TOTP unit tests
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
GET /api/v1/gate/sync-event/{event_id}
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
| **1** | ✅ **Done** | FastAPI backend, M-Pesa STK push, TOTP QR codes, gate scanner |
| **2** | 🔜 Next | Solidity ERC-721 NFT contract, web3.py minting, anti-scalping rules |
| **3** | 🔜 Planned | Flutter ticket viewer app, Android scanner app |
| **4** | 🔜 Planned | Local Wi-Fi mesh server, offline dry-run testing, pilot event |

### Phase 2 Hooks Already in Place

The codebase is wired for Phase 2 — you just need to fill in the blanks:

- `app/worker.py` → `mint_ticket_nft()` task: replace the stub with `web3.py` contract call
- `app/models/models.py` → `Ticket.nft_token_id`, `Ticket.nft_tx_hash`: columns already exist
- `app/models/models.py` → `User.wallet_address`: column already exists
- `app/models/models.py` → `Event.contract_address`: column already exists
- `.env.example` → blockchain RPC + private key vars already documented

---

## Security Notes

- **TOTP secrets** are stored in the database. In production, encrypt them at rest using a KMS (e.g. AWS KMS, Google Cloud KMS)
- **OTP store** is currently in-memory. In production, move to Redis with TTL
- **Gate sync endpoint** (`/gate/sync-event/`) should be IP-restricted to the local server only in production
- The **M-Pesa callback** endpoint has no auth by design (Daraja requirement) — validate `checkout_request_id` to prevent spoofing
- Rotate `SECRET_KEY` and never commit it — use environment variables or a secrets manager

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI + Uvicorn |
| Database | PostgreSQL (SQLite for dev) |
| ORM | SQLAlchemy 2.0 + Alembic |
| Payments | Safaricom Daraja (M-Pesa) |
| Dynamic QR | PyOTP (TOTP) + qrcode |
| Auth | Phone OTP + JWT (python-jose) |
| SMS | Africa's Talking |
| Task Queue | Celery + Redis |
| Containers | Docker + Docker Compose |
| Phase 2 | Solidity + web3.py (Polygon/Base) |
| Phase 3 | Flutter (iOS/Android) |
