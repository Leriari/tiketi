# TiketiKE — Web 2.5 Event Ticketing Platform

> **M-Pesa payments. NFT-backed tickets. Screenshot-proof dynamic QR codes. Fully offline gate validation.**

Built for the Kenyan market. Solves ticket counterfeiting, scalping, and unreliable venue internet — without forcing users to touch crypto.

### What's real vs. what's a mock right now

The **backend** (`app/`) is a real FastAPI service covered by a passing
test suite: phone OTP auth (Redis-backed, rate-limited), organisations and
role-based authorisation, event creation, M-Pesa STK push purchase,
TOTP-based dynamic QR tickets, resale listings/wallet, and gate scanning
with enrolled scanner devices, per-gate ticket partitioning and offline
scan reconciliation, plus the full Organiser Console API (see below). NFT
minting runs on `contracts/TiketiNFT.sol`, deployed on Base Sepolia; it
needs the Celery worker running (see "Blockchain" below), and without the
blockchain env vars it's a logged no-op. Price-cap history still has no
routes.

The **frontend** (`frontend/`) is five fully built UI surfaces (Attendee,
Seller/resale, Organiser Console, Scanner, Platform Admin). The default with
no `.env` is an **in-browser mock API** (`VITE_USE_MOCK`, defaults `true`).
With `VITE_USE_MOCK=false` the real backend drives:
- OTP login (`/login`)
- the Attendee purchase→ticket journey
- the Seller/resale surface
- the whole Organiser Console
- Scanner enrolment, sync and offline scan upload

Platform Admin and three attendee extras (ticket transfer, claim to wallet,
the old organiser dashboard) are still stubs in
`frontend/src/live/liveApi.js`.

### My account (profile + activity log)

`/profile` is one profile for every role a person holds: attendee, seller,
each organisation membership, and platform admin. It is backed by
`app/api/routes/me.py`:

- `GET/PATCH /api/v1/me/profile`: identity, per-role stats, sign-in
  methods and the last sign-in (time, method, device).
- `GET /api/v1/me/activity?category=&before=`: the user's own system log.
  It's built from real records (payments, tickets, resale transfers,
  payouts, memberships) plus the audit log for sign-ins and organiser
  actions. Every sign-in is now recorded.
- `POST /api/v1/me/sign-out-everywhere`: bumps `users.session_version`.
  Every access token carries the version it was issued under (`sv`), so
  all earlier sessions end at once and this device gets a fresh token.

### Design system

The whole UI runs on one token set and component library. The reasoning is
in [docs/design-principles.md](docs/design-principles.md). After changing
any colour, run `node frontend/scripts/check-contrast.mjs`; it checks every
text/background pairing in both themes against WCAG AA.

### Organiser Console API

Every console page reads from `/api/v1/organisations/{organization_id}/...`
(`app/api/routes/organiser_console.py`). Any member of the organisation can
read; complimentary tickets, profile and payout settings are owner-only.
Events are created and edited with `POST /events/` and `PATCH /events/{id}`.
These take the full Event Management form: multiple tiers (with
visibility, sales window, per-order limit), gates, artists, image, and
resale on/off and resale window. The purchase and resale routes enforce
those settings.

The numbers come from real rows, nothing simulated:
- Earnings are successful primary payments minus the 5% platform fee and a
  KES 10/ticket scanning fee, plus settled resale royalties. They release 4
  days after the event. The owner then requests a payout of any amount;
  a finance admin approves it and it goes out by M-Pesa B2C or B2B, or is
  paid by hand (`app/services/payouts.py`, deploy/DEPLOY.md "Payouts").
- Crowd control combines online scans, manual overrides and uploaded
  offline scans.
- Exports and sales statements are CSV, generated on download.

**Event cover images** are uploaded through the event form as a data URL.
The backend (`app/services/event_images.py`) verifies the file is a real
PNG, JPEG or WebP image (5 MB max), applies the phone camera's rotation,
shrinks it to 1600px and re-encodes it as WebP. A typical upload ends up
around 20–300 KB. It's stored in the database and served from
`GET /api/v1/events/{id}/image`. Event payloads only carry `image_url`,
which changes on each re-upload so browsers can cache the image
indefinitely. Cards fall back to the category gradient when an event has
no image.

Two things have no real data behind them, and say so on screen:
- **Marketing analytics.** There's no traffic or referrer tracking.
- **Gas cost.** Gas spend isn't recorded.

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
│   │   ├── auth.py          # Phone OTP login → JWT (/auth/login is dev-only)
│   │   ├── organisations.py # Create orgs, manage members + roles
│   │   ├── organiser_console.py # Org-scoped Organiser Console API (earnings, tickets, crowd control, …)
│   │   ├── events.py        # Create (org owners only) / list events
│   │   ├── payments.py      # M-Pesa STK push + callback
│   │   ├── tickets.py       # View tickets, get TOTP seed, get QR image
│   │   ├── resale.py        # Resale listings, seller dashboard, wallet
│   │   ├── gate.py          # Scanner registration/enrolment, sync, scan, scan-upload
│   │   └── dev.py           # Dev-only OTP inbox (404s outside development)
│   ├── core/
│   │   ├── config.py        # Pydantic settings (reads .env)
│   │   ├── dependencies.py  # FastAPI user-JWT auth dependency
│   │   ├── authz.py         # Org-role, platform-admin and scanner-device checks
│   │   ├── rate_limit.py    # Redis-backed rate limiting
│   │   └── crypto.py        # Fernet encryption for TOTP secrets at rest
│   ├── db/
│   │   └── session.py       # SQLAlchemy engine + session
│   ├── models/
│   │   └── models.py        # 14-table schema
│   ├── schemas/
│   │   └── schemas.py       # Pydantic request/response schemas
│   ├── services/
│   │   ├── mpesa.py              # Daraja API: token, STK push, callback parsing
│   │   ├── totp_service.py       # TOTP secret gen, OTP verify, QR image gen
│   │   ├── auth_service.py       # OTP store (Redis), JWT issue, user creation
│   │   ├── otp_delivery.py       # console | inbox | sms (sms not implemented)
│   │   ├── gate_partitioning.py  # Assigns each ticket to exactly one gate
│   │   ├── organiser_service.py  # Event create/edit rules + Organiser Console event shape
│   │   └── web3_service.py       # NFT minting (no-op until a contract is deployed)
│   ├── main.py              # FastAPI app + router registration
│   └── worker.py            # Celery: mint_ticket_nft
├── migrations/              # Alembic migrations — the only schema authority
│   └── versions/
├── scripts/
│   └── promote_platform_admin.py  # The only way to grant PLATFORM_ADMIN
├── tests/                   # pytest — auth, orgs, purchase, resale, gate partitioning, TOTP
├── docs/
│   ├── offline-validation.md       # Offline gate validation design
│   └── evaluation/offline-accuracy.json  # Output of the accuracy harness
├── frontend/                 # React 19 + Vite SPA — 5 UI surfaces, mock API by default
│   ├── public/               # Scanner PWA manifest + service worker
│   ├── scripts/              # Offline-validation accuracy harness
│   └── src/
│       ├── pages/            # attendee/, seller/, organiser/, scanner/, admin/, Login.jsx
│       ├── shells/           # per-surface nav/layout shells
│       ├── components/ui/    # shared component library
│       ├── scanner/          # offline validator, credential store, device token
│       ├── routeGuards.jsx   # per-surface role guards (UX only — backend enforces)
│       ├── mock/mockApi.js   # the in-browser backend every surface runs against
│       └── live/liveApi.js   # real-backend client — all but Platform Admin
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Hosting (free)

The public demo runs free:
- **Frontend:** Firebase Hosting at `https://tiketi-6e9fd.web.app`.
- **Backend:** API, worker, Postgres and Redis on one Oracle Cloud Always
  Free server, behind Caddy HTTPS.

Step-by-step instructions are in **[deploy/DEPLOY.md](deploy/DEPLOY.md)**.
The production stack is `deploy/docker-compose.prod.yml`, and
`deploy/make_env.py` generates its settings.

Migrations are tested on Postgres, which production uses. To run the whole
test suite against Postgres:
`TEST_DATABASE_URL=postgresql://... pytest tests`.

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
# 1. Request OTP (delivered via OTP_DELIVERY_CHANNEL — no real SMS yet)
POST /api/v1/auth/request-otp
{ "phone_number": "0712345678" }

# 2. Verify OTP → receive JWT
POST /api/v1/auth/verify-otp
{ "phone_number": "0712345678", "otp_code": "482910" }
→ { "access_token": "eyJ..." }
```

**Firebase Authentication** (optional; set the `FIREBASE_*` values, see
`.env.example`) adds "Continue with Google". With `FIREBASE_PHONE_AUTH=true`
it also sends phone codes by real SMS; that needs Firebase's Phone provider,
which needs the Blaze plan. Firebase only proves who someone is. The
browser sends Firebase's ID token to `POST /api/v1/auth/firebase`, which
returns this API's normal session.

Every account still needs a verified phone (M-Pesa, ticket ownership, team
invites), so Google is *linked* to a phone, never a replacement for it:

```bash
POST /api/v1/auth/firebase  { "id_token": "<Firebase ID token>" }
→ phone sign-in, or Google already linked:  { "access_token": "...", "user_id": "...", "phone_number": "..." }
→ Google, first time:                       { "needs_phone": true, "link_token": "...", "email": "..." }

# First time only: verify a phone, passing the link token. This links Google
# to that phone's account (created if new, joined if it already exists).
POST /api/v1/auth/firebase    { "id_token": "<phone token>", "google_link_token": "..." }   # Firebase SMS
POST /api/v1/auth/verify-otp  { "phone_number": "...", "otp_code": "...", "google_link_token": "..." }  # built-in OTP
```

`POST /api/v1/auth/login` (phone number only, no OTP) still exists for the
test suite but returns 404 outside `APP_ENV=development`. In development
the frontend's `/login` screen shows the current code in a labelled
dev panel (read from `GET /dev/otp-inbox` when `OTP_DELIVERY_CHANNEL=inbox`).

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
# 1. Organiser registers a device for one event + gate (user JWT, org member)
POST /api/v1/gate/scanners
Authorization: Bearer <user token>
{ "event_id": "uuid", "gate_name": "North Gate" }
→ { "scanner_id": "...", "enrollment_code": "...", "expires_at": "..." }

# 2. The physical device redeems the one-time code for a device token
POST /api/v1/gate/enroll
{ "enrollment_code": "...", "device_id": "device-001" }
→ { "device_token": "...", "event_id": "...", "event_title": "...", "gate_name": "North Gate" }

# 3. Pre-event sync — returns only the tickets assigned to THIS gate
GET /api/v1/gate/sync-event/{event_id}
Authorization: Bearer <device token>
→ { "gate_name": "North Gate", "ticket_count": 1, "tickets": [{"id": "...", "totp_secret": "...", "gate_assignment": "North Gate"}], ... }

# 4. After scanning offline, upload decisions to record Attendance
POST /api/v1/gate/scan-upload
Authorization: Bearer <device token>
{ "scans": [{ "ticket_id": "...", "granted": true, "reason_code": "GRANTED", "scanned_at": "..." }] }
→ [{ "ticket_id": "...", "status": "recorded" | "duplicate" | "conflict", "detail": null }]

# Online validation of a single QR payload
POST /api/v1/gate/scan
{ "qr_payload": "TIKETI:<ticket_id>:<otp>", "scanner_id": "device-001" }
→ { "valid": true, "event_title": "...", "owner_phone": "****5678" }

# Revoke a device — its token stops working immediately
POST /api/v1/gate/scanners/{scanner_id}/revoke
```

Each ticket belongs to exactly one gate (stable hash of the ticket id across
the event's registered gates — `app/services/gate_partitioning.py`), so two
offline gates can't both admit it. Known limitation: if gates are added or
removed after devices have synced, the assignment shifts and devices must
re-sync. Uploads are idempotent per ticket. A second gate admitting an
already-admitted ticket comes back as a `conflict`, not a silent merge. See
[docs/offline-validation.md](docs/offline-validation.md) for the full design.

The Scanner surface (`/scanner`) is an installable PWA. Its service worker
caches only the static app shell and never touches `/api/` requests.

To measure offline-validation accuracy (100 / 1,000 / 5,000 scans through
the real `validate.js`, written to `docs/evaluation/offline-accuracy.json`):

```bash
cd frontend && npm run measure:offline-accuracy
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

The test suite uses an in-memory SQLite DB and a mocked STK push:

- Phone OTP auth → JWT issuance, single-use codes, attempt lockout, rate limits, fail-closed dev routes
- Organisations, member roles and the "never ownerless" rule
- Org-scoped event creation
- Ticket purchase → M-Pesa callback simulation → ticket activation
- TOTP seed retrieval and QR code generation (PNG validation)
- Resale listings and wallet
- Scanner registration → enrolment → device-token sync → revoke
- Gate partitioning (no overlap, full coverage) and scan-upload idempotency/conflicts
- Gate scan → USED marking → double-scan rejection

Frontend scanner logic has its own Vitest tests (`cd frontend && npm test`).

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| **1** |  **Partial** | Core flow works (auth, events, M-Pesa purchase, TOTP QR, gate scan) — but only 6 of the schema's 14 tables have routes; organizer accounts, gate-scanner registration, resale/transfers, and audit/notification tables are still unwired |
| **1.5** | Done | Frontend: 5 full UI surfaces built (`frontend/`), currently mock-API only — see "What's real vs. what's a mock" above |
| **2** | **Partial** | `contracts/TiketiNFT.sol` (ERC-721 + ERC-2981) is written, tested (29 passing), and verified end-to-end against a local chain. Backend minting (`app/services/web3_service.py`) is wired in. **Not yet deployed to Base Sepolia** — needs a funded wallet + RPC, see `contracts/README` below |
| **3** | Planned | Flutter ticket viewer app, Android scanner app |
| **4** | Planned | Local Wi-Fi mesh server, offline dry-run testing, pilot event |

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
# On Windows, Celery's default prefork pool doesn't work — add --pool=solo:
venv\Scripts\python -m celery -A app.worker worker --loglevel=info -Q celery,blockchain --pool=solo
```

Without a running worker, paid tickets stay `ACTIVE` but un-minted (the
mint jobs wait in Redis and are processed as soon as a worker starts).

Tickets mint to that relayer wallet (custodial), not the buyer's own
address — see the docstring in `app/services/web3_service.py` for why.
Real self-custody happens only if a user calls the contract's
`claimTicket` (the frontend's "Claim to wallet" flow) — that side isn't
wired into the backend yet, only minting is.

---

## Roles & Authorisation (Work Order 04)

Five roles: `ATTENDEE` (default — every user, buy/hold/resell/claim own
tickets), `ORGANISER_OWNER`/`ORGANISER_STAFF` (scoped to one organisation
via `OrganizerMember.role` — owner can do everything for their org and its
events, staff can view and scan but not create or withdraw),
`SCANNER` (a device identity, not a user — see below), `PLATFORM_ADMIN`
(the one global role, `User.is_platform_admin`).

- `/api/v1/organisations/` — create an organisation (creator becomes
  owner), invite/list/re-role/remove members. An organisation can never be
  left with no owner.
- Event creation requires `organization_id` and an `ORGANISER_OWNER`
  membership in it — every event belongs to an organisation now.
- Scanner devices: an organiser registers a device for one event+gate via
  `POST /gate/scanners` and gets a one-time enrolment code; the physical
  device submits it once via `POST /gate/enroll` and gets back a
  long-lived device token (scoped to that single event+gate). Sync
  authenticates with that token, not a user JWT. `POST /gate/scanners/{id}/revoke`
  invalidates it immediately.
- **Bootstrapping the first `PLATFORM_ADMIN`**: there is no code path that
  lets a user grant this to themselves. Run manually against the database:
  ```bash
  python scripts/promote_platform_admin.py 0712345678
  python scripts/promote_platform_admin.py 0712345678 --revoke
  ```

## Security Notes

- **TOTP secrets** (`Barcode.token`) are encrypted at rest with Fernet (`CREDENTIAL_ENCRYPTION_KEY`, required env var) — Work Order 04 A4. Decrypted only lazily, in one place (`Ticket.totp_secret`), when a code actually needs to be computed or synced
- **OTP store** moved from an in-memory dict to Redis, with a TTL matching `OTP_EXPIRE_SECONDS` — Work Order 04 A1. Codes are single-use and locked out after 5 wrong attempts (`app/services/auth_service.py`)
- **Rate limiting** (Redis-backed, by phone number *and* client IP) on `/auth/request-otp`, `/auth/verify-otp`, `/auth/login`, and by authenticated user on `/payments/purchase` — Work Order 04 A3 (`app/core/rate_limit.py`)
- **OTP delivery is pluggable** (`OTP_DELIVERY_CHANNEL=console|inbox|sms`, `app/services/otp_delivery.py`) — Work Order 04 A5. `sms` raises `NotImplementedError` naming the gateway that would go here; no real SMS provider is integrated. `inbox` writes to the `notifications` table, readable via the dev-only `GET /dev/otp-inbox`, which 404s outside `APP_ENV=development` and cannot even be enabled outside development (`Settings` refuses to construct with that combination)
- `APP_ENV` is now a required env var with no default — an unset `APP_ENV` fails the app at startup rather than silently behaving as development
- **`/auth/login`** (no-OTP login) returns 404 outside `APP_ENV=development` — Work Order 05 A1. The only real login path is request-otp → verify-otp
- **Gate sync and scan-upload** authenticate with a scanner device token (stored only as a SHA-256 hash), never a user JWT, and only for that device's own event+gate. Revoking the device invalidates the token immediately — Work Order 04 B4
- **Frontend route guards** (`frontend/src/routeGuards.jsx`) only improve the user experience. Every permission is enforced server-side in `app/core/authz.py`
- The **M-Pesa callback** endpoint has no auth by design (Daraja requirement) — validate `checkout_request_id` to prevent spoofing
- `SECRET_KEY`, `MPESA_CALLBACK_URL`, and `CREDENTIAL_ENCRYPTION_KEY` are required env vars with no default — the app refuses to start if any is unset, rather than silently running with an insecure placeholder. Rotate and never commit them — use environment variables or a secrets manager
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
| SMS | Not implemented — OTP delivered via console or the dev-only inbox |
| Scanner | Installable PWA, offline TOTP validation in the browser |
| Task Queue | Celery + Redis |
| Containers | Docker + Docker Compose |
| Phase 2 | Solidity + web3.py (Polygon/Base) |
| Phase 3 | Flutter (iOS/Android) |
