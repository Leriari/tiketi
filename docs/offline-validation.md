# Offline gate validation — design (Work Order 03)

> **Status (Work Order 05, Blocks A–B):** the device authorisation model and
> the sync payload described below are from Work Order 03's original design
> and are now superseded in two ways. Work Order 04 B4 replaced the
> "caller must be the event's creator" JWT check with real scanner device
> tokens (register → enrol → long-lived token; see
> `app/core/authz.py::get_current_scanner`). Work Order 05 B1 added real
> per-ticket gate partitioning on top of that. The historical sections below
> are kept for the reasoning they record; **"Gate authorization model" and
> "The sync payload"'s request/response shapes are out of date** — see
> "Gate partitioning (Work Order 05 B1)" and "Scan reconciliation (Work
> Order 05 B5)" further down for what's actually true today.

## Why this exists

The project's design states gate validation runs entirely on the scanning device,
with no network connectivity required to admit or refuse a ticket holder. Before this
work order, that was not true: `/gate/scan` was a cloud endpoint requiring internet,
and the Scanner PWA's "offline" behaviour was a `localStorage`-backed simulation
validated against a fake hash (`src/mock/scanValidation.js`), not real cryptography.
This document is the schema and design decided *before* writing the validator, per
A2 — so the schema doesn't drift while coding it.

## The one rule everything here follows

**No network call occurs inside the validation path.** Syncing credentials (before
doors open) and uploading scan results (after, or periodically if connectivity
exists) both use the network. The decision to admit or refuse a specific scan does
not, ever, under any condition — not even as a "just to be safe" fallback. See
`frontend/src/scanner/validate.js`'s own header comment, and the no-network test in
`validate.offline.test.js`, which asserts this stays true.

## Gate authorization model

**A real gap found during the A1 survey, not anticipated by the original work
order:** `/gate/sync-event/{event_id}`'s authorization checked membership in
`OrganizerMember` and `GateScanner` — two tables no route in the codebase ever wrote
a row to. Both were permanently empty, so the endpoint was unreachable by anyone.

Fixed by adding the one piece of event-ownership data that was missing entirely:
`Event.created_by_user_id`, set automatically by `POST /events/` going forward (set
by the backend from the authenticated caller — a client cannot assign an event to
someone else). A gate device may register and sync for an event **only if the
requesting user is that event's creator.** This is the only honest definition of
"organizer" that exists in the codebase today — the full `Organizer`/`OrganizerMember`
business-account system stays unwired and out of this work order's scope, per rule 4.

Events created before this change have `created_by_user_id = NULL` and are not
gate-manageable by anyone until recreated. This is expected, not a bug to work around.

## The sync payload

One call, extending the existing `GET /gate/sync-event/{event_id}` rather than adding
a parallel endpoint — now accepting `device_id` and `gate_name` as query parameters.

**Request:** `GET /gate/sync-event/{event_id}?device_id=<client-generated UUID>&gate_name=<free text>`
(authenticated — the caller must be the event's creator)

Behaviour:
1. Looks up (or creates, if `device_id` is new) a `GateScanner` row for
   `(event_id, device_id)`, owned by `current_user.id`, with the given `gate_name`,
   and updates `last_sync_at`.
2. Writes an `AuditLog` row (`action_type="gate_sync"`) — unchanged from before.
3. Returns every `ACTIVE` ticket for the event, in the shape below.

**No per-ticket gate assignment existed in the real schema as of Work Order 03** —
now built, see "Gate partitioning (Work Order 05 B1)" below. The request/response
shapes immediately following this paragraph are the original, now-superseded ones.

**Response (historical — see B1 below for the current shape):**

```jsonc
{
  "event_id": "uuid",
  "event_title": "string",
  "event_date": "iso8601",            // credentials auto-wipe at event_date + 24h — see A4
  "gate_name": "string",               // echoes what this device registered as
  "scanner_id": "uuid",                // the GateScanner row's id
  "device_id": "string",               // echoes the client-generated device id
  "synced_at": "iso8601",
  "ticket_count": 0,
  "tickets": [
    {
      "id": "uuid",
      "tier_name": "string",
      "seat_number": "string | null",
      "gate_assignment": null,          // always null today — see above
      "totp_secret": "base32 string",   // 32 chars, 160-bit — see totp_service.py
      "status": "active"                // the ticket's status AT SYNC TIME
    }
  ]
}
```

## What each offline check needs, and where it comes from

| # | Check | Uses |
|---|---|---|
| 1 | Format & integrity | Payload parses as `TIKETI:<ticket_id>:<otp>`; `ticket_id` exists in the synced cache for this event |
| 2 | TOTP window | `tickets[].totp_secret`, base32-decoded to raw bytes, HMAC-SHA1 via Web Crypto, RFC 6238, 30s step, current window ±1 (matches `totp_service.verify_otp`'s `valid_window=1` exactly — a 90-second acceptance range) |
| 3 | Prior admission | The device's own local admissions store (IndexedDB) — has this ticket already been granted *on this device* since sync — not the synced `status` field, which only reflects state at sync time |
| 4 | Gate assignment | `tickets[].gate_assignment` — now always equal to this device's own gate (Work Order 05 B1: a device only ever receives tickets already assigned to it), so this check passes trivially in the normal flow. A ticket assigned to a *different* gate was never synced to this device at all, so it surfaces via check 1 (`UNKNOWN_TICKET`), not this one — `WRONG_GATE` stays defined in validate.js (unchanged, per rule 3) as defence in depth, not dead code to remove |

## Credential lifecycle

- Stored in IndexedDB (`frontend/src/scanner/credentialStore.js`), not `localStorage` —
  thousands of 32-character secrets plus admission records is the wrong shape for a
  synchronous, string-only, ~5MB-capped store.
- Two object stores: `credentials` (keyed by ticket id) and `admissions` (keyed by
  ticket id, written the instant a grant happens — before the verdict is returned to
  the UI, so a double-scan a second later is caught even without a re-sync).
- Auto-wiped (both stores cleared) once `now() > event_date + 24h`, checked on app
  load. Raw TOTP secrets sitting indefinitely on a steward's personal phone are the
  most sensitive data this system holds.

## Reason codes (the offline validator's output)

A structured verdict, not a boolean — these become the evaluation categories:

| Code | Meaning |
|---|---|
| `GRANTED` | All four checks passed |
| `INVALID_FORMAT` | Payload isn't a well-formed `TIKETI:<id>:<otp>` string |
| `UNKNOWN_TICKET` | `ticket_id` not present in this device's synced cache |
| `BAD_OTP` | Parses fine, but no accepted window produces this code |
| `ALREADY_ADMITTED` | Found in this device's local admissions store |
| `WRONG_GATE` | `gate_assignment` set and doesn't match this device's gate — defined but effectively unreachable under real partitioning (see check 4 above); a mismatched ticket now shows as `UNKNOWN_TICKET` instead |

## Gate partitioning (Work Order 05 B1)

`app/services/gate_partitioning.py`: `assign_gate(ticket_id, sorted_gate_names)` — a
stable SHA-256 hash of `ticket_id`, modulo the event's current, alphabetically sorted
list of registered gate names. Computed fresh on every sync, not stored. Purchase-time
assignment was the alternative and was rejected: gates (`GateScanner` rows) are
typically registered close to the event, often after most tickets have already sold
(Work Order 04 B4's enrolment flow), so there would usually be no gates to assign to
yet at purchase time.

`GET /gate/sync-event/{event_id}` (now device-token authenticated — see the status
note at the top of this document) computes every active ticket's assigned gate and
returns **only the ones matching the requesting device's own gate**, with
`gate_assignment` echoing that gate's real name instead of always `null`.

**The one real limitation, stated plainly**: the assignment is only stable for as
long as the event's registered-gate set doesn't change. Registering a new gate (or
deactivating one) after some devices have already synced changes the modulo base,
which reshuffles every ticket's assignment on the next sync. A device that synced
before the change keeps serving its stale assignment until it re-syncs. This is a
known property of a computed-not-stored scheme, not an oversight — organisers should
register all of an event's gates before any device syncs, not add one mid-event.

## Scan reconciliation (Work Order 05 B5)

`POST /gate/scan-upload` (device-token authenticated): uploads a batch of offline
decisions, writing real `Attendance` rows with `denial_reason` populated for denials.

Idempotent by `ticket_id`, not by upload call — phones retry, and a naive "insert
every row" would corrupt the evaluation data with duplicates:
- An **admit** retried by the *same* scanner is a no-op (`"duplicate"`).
- An **admit** for a ticket already admitted by a *different* scanner (two gates
  offline at once, or a partitioning edge case from the limitation above) is reported
  as `"conflict"`, with the original scanner id and time — never silently merged or
  overwritten. This is deliberate: the work order treats that situation as a finding
  worth reporting in Chapter 5, not an error to make disappear.
- A **denial** retried with the same ticket/scanner/reason/timestamp is deduplicated.
