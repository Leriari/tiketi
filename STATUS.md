# TiketiKE / ChainTix — Codebase Status Report

Read-only audit. Every claim below is tagged `[VERIFIED]` (a command was run and its
real output is shown), `[READ]` (source was read, not executed), or `[UNKNOWN]`
(could not be determined, with a note on what's needed to find out).

Audit date: 2026-09-21.

---

## 1. Environment

`[VERIFIED]`

```
$ python --version
Python 3.12.10

$ node --version
v22.14.0

$ npm --version
11.6.2

$ git --version
git version 2.46.0.windows.1

$ docker --version
Docker version 27.5.1, build 9f9e405

$ docker ps
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

`docker ps` returned zero rows — **no containers are currently running**, despite a
full `docker-compose.yml` (API + Postgres + Redis + worker) existing in the repo.

OS: Windows 11 (`MINGW64_NT-10.0-26200`, via Git Bash / MSYS2).
Project root: `C:\Users\tobik\OneDrive\Desktop\tiketi`.

---

## 2. Repository layout

`[VERIFIED]` (directory tree via `find`, depth 3, excluding `node_modules`, `venv`,
`__pycache__`, `.git`, `artifacts`, `cache`, `dist`, `build`)

```
.
├── .claude/                    Claude Code tool state (not project code)
├── .env, .env.example          Backend config
├── .pytest_cache/              Test tool cache (auto-generated)
├── Dockerfile                  Backend container image
├── Leriari Peter Tobiko_...docx/.pdf   A university final-year report — committed to git
├── README.md                   Backend project README (stale — no mention of frontend/)
├── alembic.ini                 Alembic config
├── app/                        FastAPI backend — the entire server-side implementation
│   ├── api/routes/             5 route files (auth, events, payments, tickets, gate)
│   ├── core/                   Settings (Pydantic) + auth dependency
│   ├── db/                     SQLAlchemy engine/session
│   ├── models/                 One file, 14 ORM models
│   ├── schemas/                One file, all Pydantic request/response schemas
│   └── services/                auth_service, mpesa, totp_service
│   worker.py                   Celery app + 2 tasks (one is an explicit stub)
├── dev.db                      SQLite dev database (not tracked in git)
├── docker-compose.yml          Postgres + Redis + API + worker (profile-gated) stack
├── frontend/                   React 19 + Vite SPA — 5 UI "surfaces", ~11.3k lines
│   └── src/{components,pages,shells,mock,live,...}
├── migrations/                 Alembic migrations, 2 files, linear chain
├── requirements.txt            Backend Python deps
├── spec.md                     A UI design/build spec pasted by the project owner
└── tests/                      2 test files, 26 tests, backend only — no frontend tests
```

No `contracts/`, no `hardhat.config.*`, no `.sol` file, no `deployments/` directory
anywhere in the repository — confirmed by an unrestricted `find . -iname "*.sol"` /
`find . -iname "hardhat.config*"` sweep of the whole tree. See §4.

### Top-level directories — one line each

| Dir | Contents |
|---|---|
| `app/` | The FastAPI backend: routes, models, schemas, services, config |
| `frontend/` | React SPA implementing 5 UI surfaces against a **mock** API by default |
| `migrations/` | Alembic schema migrations (2, linear) |
| `tests/` | Backend pytest suite (26 tests, all passing) |
| `.claude/` | Claude Code session/tool state, not part of the application |

### File line counts

File count in `app/` + `tests/` + `migrations/` + `frontend/src/` exceeds 120, so per
the instructions this is grouped by directory with totals rather than listed file by
file for the largest buckets. Backend files (small enough to list individually) are
listed in full; frontend is grouped.

**Backend — every file** `[VERIFIED]` (`wc -l`)

| Path | Lines | Language |
|---|---|---|
| app/models/models.py | 425 | Python |
| app/api/routes/payments.py | 264 | Python |
| app/schemas/schemas.py | 188 | Python |
| app/services/mpesa.py | 180 | Python |
| app/api/routes/gate.py | 121 | Python |
| app/services/totp_service.py | 112 | Python |
| app/services/auth_service.py | 105 | Python |
| app/api/routes/tickets.py | 105 | Python |
| app/worker.py | 96 | Python |
| app/api/routes/events.py | 79 | Python |
| app/api/routes/auth.py | 78 | Python |
| app/main.py | 52 | Python |
| app/core/config.py | 49 | Python |
| app/core/dependencies.py | 29 | Python |
| app/db/session.py | 27 | Python |
| app/{__init__,api/__init__,api/routes/__init__,core/__init__,db/__init__,models/__init__,schemas/__init__,services/__init__}.py | 0 each | Python (empty) |
| **app/ total** | **1,910** | |
| tests/test_api.py | 275 | Python |
| tests/test_totp.py | 102 | Python |
| tests/__init__.py | 0 | Python |
| **tests/ total** | **377** | |
| migrations/versions/82496cbf05c9_chaintix_14_table_schema.py | 236 | Python |
| migrations/versions/15109d1c5b7f_initial_schema.py | 99 | Python |
| migrations/env.py | 93 | Python |
| **migrations/ total** | **428** | |

**Frontend — grouped by directory** `[VERIFIED]` (125 `.jsx`/`.js`/`.css` files under `src/`)

| Directory | Lines |
|---|---|
| src/pages/ (all surfaces) | 5,972 |
| src/mock/ (in-browser mock backend) | 2,179 |
| src/components/ (37-component UI library + misc) | 1,775 |
| src/shells/ (per-surface layout shells) | 412 |
| src/live/ (real-backend API client) | 165 |
| src/styles/ | 173 |
| src/lib/ | 129 |
| src/scanner/ | 92 |
| src/App.jsx + root src files | 291 |
| src/theme/ | 36 |
| src/context/ | 40 |
| **Total frontend src/** | **~11,264** |

Pages broken down by surface `[VERIFIED]`:

| Surface | Files | Lines |
|---|---|---|
| src/pages/organiser/ | 20 | 1,932 |
| src/pages/attendee/ | 8 | 1,269 |
| src/pages/seller/ | 11 | 1,038 |
| src/pages/admin/ | 13 | 956 |
| src/pages/scanner/ | 2 | 463 |
| src/pages/dev/ (component showcase) | 1 | 314 |

---

## 3. Backend (FastAPI)

### 3a. Structure

`[READ]` — every file under `app/`:

| File | Role |
|---|---|
| `app/main.py` | FastAPI app instance, CORS, router registration, `/` health check, runs `Base.metadata.create_all()` on startup (separate from Alembic — see §11 #9) |
| `app/core/config.py` | Pydantic `Settings` (env-driven), `MPESA_BASE_URL` property |
| `app/core/dependencies.py` | `get_current_user` — JWT bearer auth dependency |
| `app/db/session.py` | SQLAlchemy engine, `SessionLocal`, `Base`, `get_db` |
| `app/models/models.py` | All 14 ORM models + enums (single file) |
| `app/schemas/schemas.py` | All Pydantic request/response models, phone normalizer |
| `app/api/routes/auth.py` | `/request-otp`, `/verify-otp`, `/me`, `/login` |
| `app/api/routes/events.py` | `POST /`, `GET /`, `GET /{id}` |
| `app/api/routes/payments.py` | `/purchase`, `/mpesa/callback`, `/{id}/status`, `/{id}/dev-confirm` |
| `app/api/routes/tickets.py` | `/my`, `/{id}/seed`, `/{id}/qr.png` |
| `app/api/routes/gate.py` | `/scan`, `/sync-event/{event_id}` |
| `app/services/auth_service.py` | OTP generation/storage (in-memory dict), JWT issue/decode, user create |
| `app/services/mpesa.py` | Daraja OAuth token, STK push, callback parsing, status query |
| `app/services/totp_service.py` | TOTP secret gen, OTP verify, QR PNG gen, payload build/validate |
| `app/worker.py` | Celery app + `mint_ticket_nft` (explicit stub) + `send_ticket_confirmation_sms` |

### 3b. API surface — complete endpoint table

`[READ]` — every router file read in full.

| Method | Path | Handler | Auth required? | Status |
|---|---|---|---|---|
| GET | `/` | `health_check` | No | IMPLEMENTED |
| POST | `/api/v1/auth/request-otp` | `request_otp` | No | IMPLEMENTED |
| POST | `/api/v1/auth/verify-otp` | `verify_otp` | No | IMPLEMENTED |
| GET | `/api/v1/auth/me` | `get_me` | Yes (JWT) | IMPLEMENTED |
| POST | `/api/v1/auth/login` | `login` | No | IMPLEMENTED |
| POST | `/api/v1/events/` | `create_event` | Yes (JWT) | IMPLEMENTED |
| GET | `/api/v1/events/` | `list_events` | No | IMPLEMENTED |
| GET | `/api/v1/events/{event_id}` | `get_event` | No | IMPLEMENTED |
| POST | `/api/v1/payments/purchase` | `purchase_ticket` | Yes (JWT) | IMPLEMENTED |
| POST | `/api/v1/payments/mpesa/callback` | `mpesa_callback` | No (Daraja requirement) | IMPLEMENTED |
| GET | `/api/v1/payments/{payment_id}/status` | `get_payment_status` | Yes (JWT) | IMPLEMENTED |
| POST | `/api/v1/payments/{payment_id}/dev-confirm` | `dev_confirm_payment` | Yes (JWT) + `APP_ENV==development` gate | IMPLEMENTED (dev-only by design) |
| GET | `/api/v1/tickets/my` | `get_my_tickets` | Yes (JWT) | IMPLEMENTED |
| GET | `/api/v1/tickets/{ticket_id}/seed` | `get_ticket_seed` | Yes (JWT) | IMPLEMENTED |
| GET | `/api/v1/tickets/{ticket_id}/qr.png` | `get_ticket_qr` | Yes (JWT) | IMPLEMENTED |
| POST | `/api/v1/gate/scan` | `scan_ticket` | **No** | IMPLEMENTED (contains dead code — see §11 #1) |
| GET | `/api/v1/gate/sync-event/{event_id}` | `sync_event_tickets` | **No** | IMPLEMENTED — but returns raw TOTP secrets to any caller (see §11 #2) |

**16 endpoints total, all IMPLEMENTED, zero STUB/PARTIAL handlers found in the router files themselves.** The gaps in this codebase are not stub handlers — they're entire *routes that don't exist yet* for 8 of the 14 data models (Organizer, OrganizerMember, PriceCap, Transfer, GateScanner, Attendance, AuditLog, Notification — see §3c).

### 3c. Data models

`[READ]` — `app/models/models.py`, full file.

| Model | Table | Key columns | FKs | Wired to a route? |
|---|---|---|---|---|
| `User` | `users` | id, phone_number (unique), display_name, email, is_active, wallet_address, external_wallet_address, is_organizer | — | Yes |
| `Organizer` | `organizers` | id, business_name, kra_pin, verification_status, mpesa_paybill, royalty_wallet_address | — | **No** (comment: "Not yet wired to any route (Phase 2)") |
| `OrganizerMember` | `organizer_members` | id, organizer_id, account_id, role | → organizers, → users | **No** |
| `Event` | `events` | id, organizer_id, title, venue, event_date, organizer_phone, total_capacity, tickets_sold, contract_address, status | → organizers (nullable) | Yes |
| `EventTier` | `event_tiers` | id, event_id, tier_name, price_kes, capacity, tickets_sold, resale_floor/ceiling_price_kes, organizer_royalty_percent | → events | Partially — created internally by `create_event`, never exposed as a multi-tier API |
| `Ticket` | `tickets` | id, event_id, tier_id, owner_id, gate_scanner_id, status, nft_token_id, nft_tx_hash, seat_number | → events, → event_tiers, → users, → gate_scanners | Yes |
| `Payment` | `payments` | id, ticket_id (unique), tier_id, user_id, amount_kes, status, merchant_request_id, checkout_request_id (unique), mpesa_receipt_number, phone_number | → tickets, → event_tiers, → users | Yes |
| `Barcode` | `barcodes` | id, ticket_id, event_id, owner_id, token, token_version, status, expires_at | → tickets | Yes (via `Ticket.current_barcode`/`totp_secret` shim) |
| `PriceCap` | `price_caps` | id, event_id, tier_id, cap_price_kes, floor_price_kes, change_type, effective_at | → events, → event_tiers | **No** |
| `Transfer` | `transfers` | id, ticket_id, seller_id, buyer_id, payment_id, transfer_type, transfer_price_kes, organizer_royalty_kes | → tickets, → users (x2), → payments | **No** |
| `GateScanner` | `gate_scanners` | id, event_id, organizer_id, account_id, gate_name, device_id (unique), last_sync_at, status | → events, → organizers, → users | **No** |
| `Attendance` | `attendances` | id, ticket_id, event_id, scanner_id, scan_time, status | → tickets, → events, → gate_scanners | **No** — `gate.py` mutates `Ticket.status` directly instead |
| `AuditLog` | `audit_logs` | id, actor_id, action_type, target_id, target_type, created_at | → users (nullable) | **No** |
| `Notification` | `notifications` | id, recipient_id, notification_type, channel, status, sent_at | → users | **No** |

**8 of 14 models have zero corresponding route code.** All 14 have a migration (see §3d)
— no model exists in code without a migration.

### 3d. Migrations

`[VERIFIED]`

```
$ ./venv/Scripts/python.exe -m alembic history
15109d1c5b7f -> 82496cbf05c9 (head), chaintix_14_table_schema
<base> -> 15109d1c5b7f, initial_schema

$ ./venv/Scripts/python.exe -m alembic current
82496cbf05c9 (head)
```

Two migrations, **linear** (single `down_revision` chain, no branch points). Current
DB is at head. `alembic check` (below, §8) reports no drift between models and the
live schema.

### 3e. Does it start?

`[VERIFIED]`

```
$ ./venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8123
INFO:     Started server process [26824]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8123 (Press CTRL+C to quit)

$ curl -s http://127.0.0.1:8123/
{"status":"ok","service":"TiketiKE API","version":"1.0.0","env":"development"}

$ curl -s http://127.0.0.1:8123/api/v1/events/
[{"id":"5bcbce3c-...","title":"Test", ...}, {"id":"fdead381-...","title":"Nairobi Tech Meetup", ...}, ... 4 events total]
```

**Started clean. No warnings on startup.** Live query against `dev.db` returned real
rows. Server was killed after verification; confirmed no process left listening on
the test port (`netstat` showed no LISTENING entry afterward).

### 3f. Tests

`[VERIFIED]`

```
$ ./venv/Scripts/python.exe -m pytest tests/ -v
...
tests/test_api.py::test_health PASSED
tests/test_api.py::test_request_otp_invalid_phone PASSED
tests/test_api.py::test_verify_otp_wrong_code PASSED
tests/test_api.py::test_get_me_unauthenticated PASSED
tests/test_api.py::test_get_me_authenticated PASSED
tests/test_api.py::test_list_events_empty PASSED
tests/test_api.py::test_create_event PASSED
tests/test_api.py::test_get_event_by_id PASSED
tests/test_api.py::test_get_event_not_found PASSED
tests/test_api.py::test_get_my_tickets_empty PASSED
tests/test_api.py::test_purchase_requires_auth PASSED
tests/test_api.py::test_purchase_invalid_event PASSED
tests/test_api.py::test_full_mpesa_flow PASSED
tests/test_totp.py::test_generate_totp_secret_format PASSED
tests/test_totp.py::test_totp_secrets_are_unique PASSED
tests/test_totp.py::test_current_otp_is_6_digits PASSED
tests/test_totp.py::test_verify_otp_valid PASSED
tests/test_totp.py::test_verify_otp_wrong_code PASSED
tests/test_totp.py::test_verify_otp_wrong_secret PASSED
tests/test_totp.py::test_qr_payload_format PASSED
tests/test_totp.py::test_validate_scanned_payload_valid PASSED
tests/test_totp.py::test_validate_scanned_payload_bad_format PASSED
tests/test_totp.py::test_validate_scanned_payload_wrong_prefix PASSED
tests/test_totp.py::test_validate_scanned_payload_expired_otp PASSED
tests/test_totp.py::test_qr_image_is_png PASSED
tests/test_totp.py::test_seconds_until_rotation_range PASSED

======================= 26 passed, 22 warnings in 1.95s =======================
```

**26 passed, 0 failed, 22 warnings** (all `DeprecationWarning: datetime.datetime.utcnow()
is deprecated` from 6+ call sites, plus one Starlette `PendingDeprecationWarning`
about `python_multipart` — cosmetic, not functional failures).

`[READ]` — `tests/test_api.py::test_full_mpesa_flow` **mocks** `mpesa_service.stk_push`
via `monkeypatch` (lines 176–189 of that file). **No test in this suite ever calls the
real Daraja sandbox.** This is the only test that exercises the purchase→callback→
ticket→QR→scan chain, and the M-Pesa leg of it is entirely faked.

No frontend test suite exists (no `*.test.jsx`, no Jest/Vitest config found in `frontend/`).

### 3g. Background workers

`[VERIFIED]` — Redis is reachable locally:

```
$ python -c "import redis; redis.Redis(host='localhost', port=6379).ping()"
Redis: REACHABLE
$ netstat -ano | grep ':6379.*LISTENING'
  TCP    127.0.0.1:6379   0.0.0.0:0   LISTENING   19796
```

This Redis instance is **not** the one from `docker-compose.yml` (`docker ps` showed
zero containers) — some other Redis process is running natively on this machine.

`[VERIFIED]` — a Celery worker was started against it, confirmed to connect, and killed:

```
$ ./venv/Scripts/python.exe -m celery -A app.worker worker --loglevel=info --pool=solo
...
[tasks]
  . app.worker.mint_ticket_nft
  . app.worker.send_ticket_confirmation_sms
[2026-09-21 12:03:15,980: INFO/MainProcess] Connected to redis://localhost:6379/0
[2026-09-21 12:03:17,223: INFO/MainProcess] celery@Tobikos-Spectre ready.
```

Two tasks registered. **`mint_ticket_nft` is an explicit stub** (`[READ]`,
`app/worker.py` lines 43–62): it logs `"[STUB] Would mint NFT for ticket=..."` and
returns `{"status": "stub", ...}` — there is no `web3.py` call, no contract
interaction, nothing. `send_ticket_confirmation_sms` calls the real Africa's Talking
SDK when `APP_ENV != "development"` — see §9.

`[VERIFIED]` — no evidence a worker has ever actually been run as part of this
project before this audit: no `celerybeat-schedule` file, no `*.log` file anywhere in
the repo (`find . -iname "*.log"` / `find . -iname "celerybeat*"`, both empty).
Nothing in `.env` is Celery-specific beyond `REDIS_URL`. The worker **can** run in
this environment (just proven above) but there's no artifact showing it ever has,
outside of this audit.

---

## 4. Smart contracts

`[VERIFIED]` — exhaustive search of the entire repository tree:

```
$ find . -iname "*.sol"                                    → (no output)
$ find . -iname "hardhat.config*" -not -path "*/node_modules/*"   → (no output)
$ find . -type d -iname "contracts" -not -path "*/node_modules/*" → (no output)
$ find . -type d -iname "deployments" -not -path "*/node_modules/*" → (no output)
```

No root `package.json`. `frontend/package.json` contains no `hardhat`, `ethers`,
`web3`, or `solidity` dependency (`[VERIFIED]`, grep on the file: no matches).
`requirements.txt` contains no `web3` package (`[READ]`).

**4a–4g: NOT APPLICABLE. There are no Solidity files, no Hardhat project, no
deployment artifacts, and no configured networks anywhere in this repository.**
Nothing to compile, nothing to test, nothing deployed.

**4f. Deployment status: NOT DEPLOYED.** There is no contract to deploy. The DB
schema has placeholder columns for a future deployment (`Event.contract_address`,
`Ticket.nft_token_id`, `Ticket.nft_tx_hash`, `User.wallet_address`,
`Organizer.royalty_wallet_address` — all `[READ]` from `models.py`), all currently
`NULL`/empty in every row.

This directly contradicts the project's own README, which lists "Phase 2 — Solidity
ERC-721 NFT contract, web3.py minting" as `🔜 Next` (i.e., acknowledged as not started
by the codebase's own documentation) while separately describing the product in its
header as "NFT-backed tickets."

---

## 5. Blockchain integration in the backend

`[VERIFIED]` — `requirements.txt` has no `web3` entry. `grep -ril "web3\|blockchain"
app/` matches only 3 files, and reading all 3 (`[READ]`):

- `app/schemas/schemas.py`, `app/models/models.py` — only contain column definitions
  (`contract_address`, `wallet_address`, `nft_tx_hash`, etc.) with no logic attached.
- `app/worker.py` — the `mint_ticket_nft` task's **docstring** describes what Phase 2
  will do ("Load the event's smart contract via web3.py... Call contract.mint(...)...")
  but the function body does none of it. It logs and returns a stub dict.

**`NO BLOCKCHAIN INTEGRATION PRESENT`.** No ABI is loaded anywhere. No contract
address is read from config for the purpose of making a call (the columns exist only
as DB storage). No blockchain RPC client is instantiated anywhere in the codebase.
Nothing has ever been executed against a chain — there is no code path that could do so.

---

## 6. Frontend

A frontend exists.

**Framework:** React `^19.2.8` + Vite `^8.3.0` `[VERIFIED]` (`frontend/package.json`,
and `npm run build` succeeded — see below).
**Routing:** `react-router-dom` `^7.18.3`, classic `<BrowserRouter>` (not a data
router — `useBlocker` is unavailable, confirmed by direct experience building this
codebase; a data-router-only API is not used anywhere) `[READ]`.
**Styling:** Tailwind CSS `^3.4.17` with a CSS-custom-property token system
(`src/styles/tokens.css`), dual light/dark theme via a `data-theme` attribute.
**State management:** No external library (no Redux/Zustand/Jotai/etc. in
`package.json`). Local component state + two React Contexts (`AuthContext`,
`ThemeProvider`) `[READ]`.
**PWA:** `[VERIFIED]` — **NOT a PWA.** No `manifest.json`, no service worker file,
no `vite-plugin-pwa` or equivalent in `vite.config.js` (which contains only
`@vitejs/plugin-react`) anywhere in the repo. Two of the five UI "surfaces" are
internally named "Attendee PWA" and "Scanner PWA" per the design spec (`spec.md`),
but neither is installable or offline-capable via any browser PWA mechanism. The
"offline" behavior the Scanner surface demonstrates is a **client-side
localStorage/JS simulation inside a normal web page**, not a service worker.

### The single most important fact about this frontend

`[VERIFIED]` — `frontend/src/api.js`:
```
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";
export const api = USE_MOCK ? mockApi : liveApi;
```
Default is **mock**, unless `VITE_USE_MOCK` is explicitly set to the string `"false"`.

`[VERIFIED]` — `frontend/src/live/liveApi.js` (the real-backend implementation) is
165 lines. Counted directly:
```
$ grep -c "notImplemented(" src/live/liveApi.js
71
$ grep -cE "^\s+[a-zA-Z]+:" src/live/liveApi.js
85
```
**71 of ~85 API functions in the "real backend" client are stubs** that throw a 501
`ApiError` the instant they're called — regardless of whether the real FastAPI server
is even running. The ~13 that do make a real `fetch()` call cover only: `health`,
`login`, `me`, `listEvents`, `getEvent`, `createEvent`, `purchaseTicket`,
`getPaymentStatus`, `devConfirmPayment`, `myTickets`, `getTicketSeed`,
`getTicketQrBlob`, `scanTicket` — i.e., only the original Attendee purchase→ticket→
scan journey. Every function needed by the Seller Portal, Organiser Console, Scanner
PWA's sync/reconciliation, and Platform Admin surfaces is a stub. `createEvent` itself
carries an in-code comment (`[READ]`, liveApi.js line 54-57) admitting its payload
shape has "outgrown the real backend's flat `EventCreate` schema" and "will need a
payload-shape adapter before it works live" — i.e., even that one is not confidently
working, just plumbed.

`[VERIFIED]` — the in-browser mock backend (`src/mock/mockApi.js`) is **2,034 lines**
— more than 12x the size of the real client. Every screen in every surface other than
the original Attendee flow only ever runs against this mock, which persists state to
`localStorage`, not to the FastAPI backend or its database.

### Build

`[VERIFIED]`

```
$ npm run build
✓ 2045 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-CnYSqpaG.css   27.38 kB │ gzip:   6.64 kB
dist/assets/index-DtnFI6dM.js   843.35 kB │ gzip: 249.85 kB
✓ built in 9.62s
(!) Some chunks are larger than 500 kB after minification. [non-fatal warning]
```

**Builds clean.** One non-fatal bundle-size warning (843 kB main JS chunk,
uncode-split).

### Dev server

`[VERIFIED]`

```
$ npm run dev -- --port 5199
  VITE v8.3.0  ready in 1076 ms
  ➜  Local:   http://localhost:5199/
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5199/
HTTP 200
```

Starts and serves. Process was stopped and the orphaned Node process on the port was
confirmed killed afterward (Vite's dev server does not die with its parent task
handle on this platform — a second explicit `taskkill` was required, consistent with
prior experience on this project).

### Every route

`[READ]` — `frontend/src/App.jsx`, full route table, 39 routes across 4 authenticated
shells + 1 dev-only route. Status reflects: does the page render real interactive UI
(not a blank/placeholder), and is it backed by real or mock data. **Every single page
below runs against the mock API only, per the `VITE_USE_MOCK` default described
above** — "COMPLETE" here means "a fully built, interactive UI screen exists and
renders," not "connected to the real backend."

| Route | Page | Status |
|---|---|---|
| `/` | Landing | COMPLETE (mock) |
| `/events` | Browse | COMPLETE (mock) |
| `/events/:eventId` | EventDetail | COMPLETE (mock) |
| `/checkout/:eventId` | Checkout | COMPLETE (mock) |
| `/confirmation/:ticketId` | Confirmation | COMPLETE (mock) |
| `/tickets` | MyTickets | COMPLETE (mock) |
| `/tickets/:ticketId` | TicketCredential | COMPLETE (mock) |
| `/account` | Account | COMPLETE (mock) |
| `/seller` (index) | Seller Dashboard | COMPLETE (mock) |
| `/seller/sell` | SellWizard | COMPLETE (mock) |
| `/seller/listings` | MyListings | COMPLETE (mock) |
| `/seller/sold` | SoldHistory | COMPLETE (mock) |
| `/seller/wallet` | Wallet | COMPLETE (mock) |
| `/seller/payouts` | PayoutHistory | COMPLETE (mock) |
| `/seller/help` | Help | COMPLETE (mock) |
| `/seller/contact` | Contact | COMPLETE (mock) |
| `/seller/disputes` | DisputeCentre | COMPLETE (mock) |
| `/seller/profile` | Profile | COMPLETE (mock) |
| `/organiser` (index) | ControlCenter | COMPLETE (mock) |
| `/organiser/earnings` | Earnings | COMPLETE (mock) |
| `/organiser/reports` | Reports | COMPLETE (mock) |
| `/organiser/marketing` | MarketingAnalytics | COMPLETE (mock) |
| `/organiser/tickets` | TicketCentral | COMPLETE (mock) |
| `/organiser/audit` | AuditLookup | COMPLETE (mock) |
| `/organiser/events/new`, `/organiser/events/:id/edit` | EventManagement | COMPLETE (mock) |
| `/organiser/crowd-control` | CrowdControl | COMPLETE (mock) |
| `/organiser/scanners` | ScannerHub | COMPLETE (mock) |
| `/organiser/scan` | LiveScanner | COMPLETE (mock) |
| `/organiser/guests` | GuestLists | COMPLETE (mock) |
| `/organiser/contract` | ContractStatus | COMPLETE (mock) — displays fabricated on-chain data; no real chain exists (§4/§5) |
| `/organiser/royalties` | RoyaltyLedger | COMPLETE (mock) |
| `/organiser/compliance` | ResaleCompliance | COMPLETE (mock) |
| `/organiser/attendance` | Attendance | COMPLETE (mock) |
| `/organiser/revenue` | RevenueBreakdown | COMPLETE (mock) |
| `/organiser/exports` | ExportCentre | COMPLETE (mock) |
| `/organiser/profile` | OrganisationProfile | COMPLETE (mock) |
| `/organiser/payouts` | PayoutDetails | COMPLETE (mock) |
| `/organiser/team` | TeamRoles | COMPLETE (mock) |
| `/scanner` (index) | Scanner Sync | COMPLETE (mock, self-contained offline simulation) |
| `/scanner/scan` | Scanner Scan | COMPLETE (mock) |
| `/admin` (index) | PlatformDashboard | COMPLETE (mock) |
| `/admin/organisers` | OrganiserAccounts | COMPLETE (mock) |
| `/admin/events` | EventApprovals | COMPLETE (mock) |
| `/admin/costs` | PlatformCosts | COMPLETE (mock) |
| `/admin/fees` | FeeConfiguration | COMPLETE (mock) |
| `/admin/payouts` | PayoutQueue | COMPLETE (mock) |
| `/admin/compliance` | ResaleCompliance (admin) | COMPLETE (mock) |
| `/admin/fraud` | FraudSignals | COMPLETE (mock) |
| `/admin/audit` | AuditLog | COMPLETE (mock) |
| `/admin/admins` | AdminUsers | COMPLETE (mock) |
| `/admin/broadcasts` | CommunicationCenter | COMPLETE (mock) |
| `/admin/notifications` | Notifications | COMPLETE (mock) |
| `/admin/flags` | FeatureFlags | COMPLETE (mock) |
| `/dev/components` | ComponentsShowcase | COMPLETE — internal component-library reference page, not a product screen |

None marked SCAFFOLD or PARTIAL: page file line counts range 28–463 lines
(`[VERIFIED]`, `wc -l` on every attendee/seller file), none are empty shells. The
qualifier that matters is not "is the page built" (yes, extensively) but "is it
connected to anything real" (almost entirely no — see above).

---

## 7. Configuration

`[VERIFIED]` — variable **names only**, SET/EMPTY status only, no values printed
anywhere in this section or elsewhere in this report.

### `/.env` (backend)

| Variable | Present in .env? | SET or EMPTY |
|---|---|---|
| APP_ENV | Yes | SET |
| SECRET_KEY | Yes | SET |
| DEBUG | Yes | SET |
| DATABASE_URL | Yes | SET |
| REDIS_URL | Yes | SET |
| MPESA_CONSUMER_KEY | Yes | SET |
| MPESA_CONSUMER_SECRET | Yes | SET |
| MPESA_SHORTCODE | Yes | SET |
| MPESA_PASSKEY | Yes | SET |
| MPESA_CALLBACK_URL | Yes | SET |
| MPESA_ENV | Yes | SET |
| ACCESS_TOKEN_EXPIRE_MINUTES | Yes | SET |
| JWT_ALGORITHM | Yes | SET |
| OTP_EXPIRE_SECONDS | Yes | SET |
| AFRICASTALKING_API_KEY | Yes | SET |
| AFRICASTALKING_USERNAME | Yes | SET |
| TOTP_ISSUER | Yes | SET |

`/.env.example` declares the **identical** 17-variable set (`[VERIFIED]`, `comm -23`/
`comm -13` diff of the two name lists returned nothing in either direction).

**Referenced in code but missing from `.env`:** `API_V1_PREFIX` (declared in
`app/core/config.py`'s `Settings` class with a hardcoded default of `/api/v1`, never
present in `.env`, so it always silently uses the code default — not broken, just
never actually configurable today).

**In `.env` but never referenced in code:** none found — all 17 names correspond to a
`Settings` field that is read somewhere (`settings.X` in application code, or `self.X`
inside `config.py`'s own `MPESA_BASE_URL` property for `MPESA_ENV`).

### `frontend/.env`

| Variable | Present in .env? | SET or EMPTY |
|---|---|---|
| VITE_API_BASE_URL | Yes | SET |
| VITE_USE_MOCK | Yes | SET |

No `frontend/.env.example` exists. `[VERIFIED]`

### Other config files found

- `alembic.ini` — no secrets, `script_location = migrations`.
- `docker-compose.yml` — hardcodes non-secret dev credentials for the Postgres
  container (`tiketi`/`tiketi`) directly in the compose file; not a `.env`-style
  secret file, and these are dev-only throwaway values, but noted for completeness.

---

## 8. Database

**Engine:** SQLite (`[VERIFIED]` — extracted engine prefix only from `DATABASE_URL`
without exposing the connection string: `sqlite`). `docker-compose.yml` configures
Postgres 16 for a containerized run, but no container is currently running (§1), so
the database actually in use right now is the local `dev.db` SQLite file.

**Reachable right now:** `[VERIFIED]` — yes. Both a direct `sqlite3` query and a live
API call against a running server (§3e) returned real data.

**Tables and row counts:** `[VERIFIED]`

```
alembic_version: 1 rows
attendances: 0 rows
audit_logs: 0 rows
barcodes: 3 rows
event_tiers: 3 rows
events: 4 rows
gate_scanners: 0 rows
notifications: 0 rows
organizer_members: 0 rows
organizers: 0 rows
payments: 4 rows
price_caps: 0 rows
tickets: 4 rows
transfers: 0 rows
users: 4 rows
```

8 of the 14 domain tables have **zero rows** — exactly the 8 models flagged in §3c as
not wired to any route. Nothing has ever written to them.

**Schema vs. models:** `[VERIFIED]`

```
$ alembic check
No new upgrade operations detected.
```

No drift. The live SQLite schema matches the SQLAlchemy models exactly, and the
Alembic migration chain accounts for every table.

One structural risk worth flagging even though it hasn't caused drift yet: `app/main.py`
calls `Base.metadata.create_all(bind=engine)` on every startup (`[READ]`), which is a
second, independent schema-creation mechanism running alongside Alembic. If a future
model were added without a corresponding migration, `create_all` would silently
create it on next boot with no migration ever having been written — the exact failure
mode this audit was asked to check for. It hasn't happened yet (all 14 models have a
migration), but the mechanism that would let it happen unnoticed is live.

---

## 9. External integrations

### M-Pesa Daraja

**Classification: (b) code written but never successfully called.**

`[READ]` — `app/services/mpesa.py` (180 lines) implements OAuth token fetch, STK
push, callback parsing, and status polling — real `httpx` calls against
`sandbox.safaricom.co.ke` / `api.safaricom.co.ke`, not mocked at the service layer.

`[VERIFIED]` — the only test that exercises this path (`test_full_mpesa_flow`)
**monkeypatches `mpesa_service.stk_push`** to return a canned response, so the real
network call is never made in CI/test.

`[READ]` — `app/api/routes/payments.py`'s `dev_confirm_payment` endpoint docstring
states directly: *"Safaricom's sandbox can't reach `localhost` without a live ngrok
tunnel, so without this, a purchase hangs forever waiting for a callback that never
arrives."* The existence of this dev-only bypass endpoint is itself evidence that the
real callback round-trip has not been completed in this project's local development
environment. No log file, no test, and no code comment anywhere in the repo records a
successful real Daraja sandbox transaction.

### Base / blockchain RPC

**Classification: (a) not started.** See §4 and §5 in full. No RPC client, no ABI, no
contract, no chain interaction code exists anywhere.

### Email / SMS (Africa's Talking)

**Classification: (b) code written but never successfully called — and would crash
if it tried.**

`[READ]` — both `app/services/auth_service.py::send_otp_sms` and
`app/worker.py::send_ticket_confirmation_sms` call `import africastalking` inside a
branch that only runs when `settings.APP_ENV != "development"` (dev mode logs to
console instead and returns early).

`[VERIFIED]` — the package is not installed and not declared:

```
$ grep -i "africastalking" requirements.txt
(no output — not present)

$ ./venv/Scripts/python.exe -c "import africastalking"
ModuleNotFoundError: No module named 'africastalking'
```

If `APP_ENV` were ever set to anything other than `"development"`, both of these
code paths would raise `ModuleNotFoundError` on the first real SMS attempt. This has
never been exercised (no evidence of it running), but it is not merely "unverified" —
it is **verified to be currently broken** the moment it would be invoked outside dev mode.

### File storage

**Classification: (a) not started.** `[VERIFIED]` — no `boto3`, no `s3`, no
`cloudinary`, no file-upload code anywhere in `app/` or `requirements.txt` (grep
across the whole backend returned only irrelevant `.pyc` binary false-positives, no
source matches).

---

## 10. Git state

`[VERIFIED]`

```
$ git status --short
 M .claude/scheduled_tasks.lock
?? .claude/settings.local.json

$ git log --oneline -15
9aefbb8 feat: build full ChainTix UI per spec.md across 5 product surfaces
3f5f55d feat: add MVP phone-only login and dev-confirm payment endpoint
4d4cb23 feat: initialize project structure with FastAPI, SQLAlchemy, Alembic, and phone-based OTP authentication system

$ git branch -a
* main
  remotes/origin/main
```

**Uncommitted changes:** only two files, both inside `.claude/` — Claude Code's own
local tool state (`scheduled_tasks.lock`, modified) and local session settings
(`settings.local.json`, untracked). **Zero uncommitted changes to any application code.**

**Remote:** `origin` is configured (points to a GitHub repository; URL withheld per
this audit's redaction instructions, not because it contains a token — it's a plain
HTTPS GitHub URL).

Three commits total in the repository's history. The working tree is otherwise clean
and fully pushed (`main` matches `origin/main`).

**Also noted (not a git-state issue, a repo-hygiene one):** `[VERIFIED]` — two large
binary files are tracked in git: `Leriari Peter Tobiko_166913backup2 (AutoRecovered).docx`
and the matching `.pdf` (a personal academic report, ~4.0 MB + ~1.7 MB), confirmed
tracked via `git ls-files`. `dev.db` is correctly excluded via `.gitignore`'s `*.db` rule.

---

## 11. Known problems

Uncharitable, numbered, every real defect found during this audit.

| # | File:line | What is wrong | Severity |
|---|---|---|---|
| 1 | `app/api/routes/gate.py:44-52` | `validate_scanned_payload(body.qr_payload, secret="")` is called and its return value (`is_valid, result`) is immediately discarded — the function re-parses `qr_payload` manually on the very next lines and validates OTP a second, different way. Dead/redundant code; looks like a leftover from a refactor. | Minor |
| 2 | `app/api/routes/gate.py:93-121` | `GET /gate/sync-event/{event_id}` has **no authentication of any kind** and returns every active ticket's raw TOTP secret to any caller who knows an event ID. The route's own docstring admits "In production: this endpoint requires a special sync key" — it currently does not. | Major (credential leak if ever exposed beyond localhost) |
| 3 | `app/services/auth_service.py:27` | OTP store is a bare in-memory `dict` — lost on restart, and doesn't work at all across multiple server processes/workers. Self-documented as a known gap in the project's own `README.md` Security Notes section. | Major |
| 4 | `app/services/auth_service.py:66`, `app/worker.py:87` | `import africastalking` inside the non-dev SMS path — package is not in `requirements.txt` and not installed; verified `ModuleNotFoundError`. Any real (non-dev) SMS send will crash immediately. | Major |
| 5 | `app/worker.py:37-62` | `mint_ticket_nft` is an explicit, acknowledged stub — logs an intent string and returns, no blockchain code. | Blocker (for the "blockchain minting" feature specifically) |
| 6 | *(whole repo)* | No smart contract exists anywhere despite the product being described (README, spec.md) as NFT-backed. | Blocker |
| 7 | `app/core/config.py:10` | `SECRET_KEY: str = "changeme"` — insecure hardcoded fallback if `.env` is ever missing this key. (`.env` does currently set it, so not live-exploitable today, but the unsafe default exists in code.) | Minor |
| 8 | `app/core/config.py:25` | `MPESA_CALLBACK_URL` defaults to the placeholder `https://example.com/api/v1/payments/mpesa/callback` if unset. | Minor |
| 9 | `app/main.py:15` | `Base.metadata.create_all(bind=engine)` runs on every app startup, independent of and in addition to Alembic. Currently in sync (verified), but is a second, uncoordinated schema-management path that could silently mask a missing migration in the future. | Major (latent) |
| 10 | `frontend/src/live/liveApi.js` (71 of ~85 functions) | Nearly every Seller/Organiser/Scanner/Admin API function is a `notImplemented()` stub returning a 501. Flipping `VITE_USE_MOCK=false` today breaks 4 of the 5 UI surfaces entirely. | Blocker (for anything beyond the original Attendee flow against a real backend) |
| 11 | `frontend/src/live/liveApi.js:54-57` | `createEvent`'s own code comment admits its payload shape has drifted from the real backend's `EventCreate` schema and needs an adapter — the one Organiser-side function that IS wired is documented as likely broken. | Major |
| 12 | *(whole frontend)* | Not a PWA despite two surfaces being named "...PWA" — no manifest, no service worker, no PWA build plugin. | Minor (naming/expectation mismatch, not a functional bug) |
| 13 | `app/schemas/schemas.py` / `app/api/routes/events.py` | `EventTier` supports multi-tier pricing in the DB and is used internally, but `EventCreate`/`EventOut` are flat/single-tier — the backend's own tier capability is unreachable through its own API. Documented in-code as a known gap. | Major |
| 14 | *(6+ call sites: `auth_service.py`, `payments.py`, `totp_service.py`, `gate.py`) | `datetime.utcnow()` used throughout — deprecated in Python 3.12, emits warnings on every test run today, will break on a future Python version. | Minor |
| 15 | `frontend/README.md` | Untouched default Vite template README — does not describe this project at all. | Minor |
| 16 | `README.md` (root) | "Project Structure" section has no mention of `frontend/` (added after this file was last edited); Roadmap table's "Phase 1 ✅ Done" is optimistic relative to the report's own 14-table design (only 6 of 14 tables are actually wired to routes). | Minor |
| 17 | repo root | Two large personal binary files (a `.docx` and matching `.pdf`, ~5.7 MB combined) are committed to git — unrelated to the codebase, bloats repository size/history. | Minor |
| 18 | *(whole backend)* | No rate-limiting anywhere (OTP request, login, purchase) — not itself found broken, but absent, worth flagging given phone-based auth with no password. | Minor (gap, not a bug) |

Search results for the literal markers requested: `TODO`/`FIXME`/`HACK`/`XXX` — **zero
matches** in `app/` or `frontend/src/` beyond incidental phone-number-format strings
like `XXXXXXXX` in docstrings (false positives, not markers). This codebase documents
its gaps in prose ("Not yet wired to any route", "Phase 2", "STUB") rather than
TODO-style comments — the items above were found by reading every file and by
targeted greps for `stub`/`mock`/`hardcode`/`placeholder`, not by TODO-scanning alone.

---

## 12. Honest completion assessment

| Component | % | Justification |
|---|---|---|
| User authentication | **65%** | Phone → JWT works end-to-end, verified by 2 passing integration tests and a live curl against a running server. In-memory OTP store (verified via source, self-documented gap) means it breaks across restarts/multi-worker deployment; no rate-limiting. |
| Event creation and listing | **70%** | Create/list/get all implemented and verified working (tests + live curl returning real rows). But no real organizer-ownership model (any authenticated user can create any event) and the API is flat/single-tier despite the DB supporting tiers. |
| Ticket purchase flow | **50%** | The ticket/payment DB state machine, TOTP seed generation, and QR PNG generation are all verified working. The actual M-Pesa leg inside that flow has never been proven against the real Daraja sandbox (only ever monkeypatched in tests). |
| M-Pesa payment integration | **30%** | Real HTTP-calling code exists and is well-structured, but there is no evidence anywhere in the repo — no log, no passing non-mocked test, no comment — of it ever successfully completing a real Daraja round-trip. The dev-confirm bypass endpoint's existence is itself evidence the real path has not been completed locally. |
| Blockchain minting | **0%** | Verified: no contract, no web3 dependency, no RPC code, an explicit stub task that only logs. |
| Ticket resale | **10%** | Backend: `Transfer` model exists with zero routes (0 rows in DB, `[VERIFIED]`). Frontend: an extensive Seller Portal UI exists and functions against a localStorage mock only — real, but entirely disconnected from anything durable or shared. |
| QR/TOTP credential generation | **90%** | The strongest-verified part of this codebase — 13 passing unit tests plus a passing end-to-end test cover secret generation, rotation, QR image output, and scan verification. Missing only: encrypting the TOTP secret at rest (self-documented gap in README). |
| Offline gate validation | **20%** | The report's actual architecture (a local mesh server, zero cloud calls at the gate) does not exist — `/gate/scan` is a normal endpoint on the same cloud backend, requiring network access, which is the opposite of what's described. A frontend "Scanner PWA" simulates offline behavior via localStorage and is honestly built, but is not connected to `/gate/scan` at all (its equivalent live functions are stubs) and is not a real offline-capable PWA (no service worker). |
| Organiser dashboard | **10%** | Backend: zero organizer-scoped routes exist. Frontend: an extensive 20-page Organiser Console exists and is fully interactive, but 100% of its data functions are stubs against the real backend — it is a complete UI shell around data that doesn't exist server-side. |
| Frontend (any) | **90% as a standalone demo / ~15% as an integrated system** | It exists, builds cleanly (verified), runs (verified, HTTP 200), and every one of 39 routes renders real, non-trivial interactive UI. But only ~13 of ~85 API functions have any real backend wiring, and those only cover the original Attendee MVP journey — the other four "surfaces" are demo-only against fabricated local data. |

### 1. What is the single biggest blocker right now?

The frontend and backend have diverged into two projects that no longer share a
contract. The backend still only implements the original 5-route, 6-model MVP slice
(auth, events, payments, tickets, gate) it was built with. The frontend was
subsequently built out into a much larger, 5-surface, ~85-function product surface
against an in-browser mock, and the real-backend client (`liveApi.js`) was never
grown to match — 71 of its ~85 functions are stubs today. There is currently no
single flag you can flip and no single script you can run that produces a working,
fully-integrated system; the two halves would need real reconciliation work
(new backend routes for Organizer/resale/dashboard/gate-device-sync, or a scoped-down
frontend) before "flip VITE_USE_MOCK off" would mean anything beyond the original
five-endpoint slice.

### 2. Shortest path to a working end-to-end demo

Using only what is already verified to work, in dependency order:

1. **Seed one real event** via `POST /api/v1/events/` directly (curl or `/docs`) — do
   not use the Organiser Console UI for this; its `createEvent` call is flagged as
   likely broken against the real schema (§11 #11).
2. **Set `frontend/.env`: `VITE_USE_MOCK=false`**, point `VITE_API_BASE_URL` at the
   running backend.
3. **Run the backend for real** (`uvicorn app.main:app`) — confirmed clean startup.
4. **Drive the Attendee flow only** (Landing → Browse → Event → Checkout) — this is
   the one path with real `liveApi` wiring.
5. **Bypass the real M-Pesa callback** using the already-built
   `POST /payments/{id}/dev-confirm` endpoint (dev-only, gated on `APP_ENV`) — the
   real Daraja round-trip has never been proven to complete locally (§9), so
   attempting it live is the least certain step in this whole list and would need
   its own debugging session (ngrok tunnel + sandbox credentials) if a *real* M-Pesa
   leg is required for the demo.
6. **Ticket view / QR** — `getTicketSeed` and `getTicketQrBlob` are real and verified
   working end-to-end in tests.
7. **Gate scan** — the real `/gate/scan` endpoint works (verified by the passing
   `test_full_mpesa_flow`), but **no current frontend page calls it live**: the
   Organiser Console's Scanner Hub / Live Scanner pages are mock-only, and the
   standalone Scanner PWA's equivalent functions (`syncGateData`, `reportScanBatch`)
   are stubs. The missing piece for step 7 specifically is either (a) a small
   temporary manual-entry page/curl call hitting `/gate/scan` directly, or (b)
   implementing the 2 real `liveApi` functions the Scanner surface needs.

Steps 1–6 could plausibly work today with some debugging. Step 7 is the one
genuinely missing link for a demo that includes the gate-scan leg through the actual
UI rather than a direct API call.

### 3. What is most likely to be silently broken?

- **`liveApi.js::createEvent`** — its own author's comment says the payload shape has
  drifted; plausible it has not been exercised since the Organiser Console was built.
- **The real Daraja STK push** — written correctly to spec, never proven to complete
  a real round-trip (only ever monkeypatched in tests); the existence of the
  dev-confirm workaround is itself evidence it doesn't work standalone without an
  ngrok tunnel that may or may not currently be configured correctly.
- **Africa's Talking SMS** — verified to throw `ModuleNotFoundError` the instant
  `APP_ENV` is anything but `"development"`, because the package was never installed.
- **Any of the 71 stubbed `liveApi.js` functions** — by construction, none of them
  have ever executed against anything real; flipping `VITE_USE_MOCK` without matching
  backend work sends four of five UI surfaces dark with 501s immediately.
- **`gate.py`'s discarded `validate_scanned_payload` call** (§11 #1) — looks
  intentional at a glance, is actually dead code from what appears to be an
  incomplete refactor; a sign the gate-scan logic path has been touched more times
  than it's been re-read end to end.
