# Offline gate validation — design (Work Order 03)

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

**No per-ticket gate assignment exists in the real schema** (the mock's
`ticket.gate_assignment` string has no backend equivalent — `Ticket.gate_scanner_id`
records which device scanned a ticket *in*, after the fact, not a pre-assignment to a
specific gate). So for now, every device registered for an event receives the
**same, full set** of that event's active tickets — "partitioning" in this work order
means *device-level authorization* (only a registered device for this event can sync
at all), not yet *ticket-level* partitioning across multiple simultaneous gates. Real
per-ticket gate assignment (so two gates offline at once can't both admit the same
ticket) is a distinct, larger feature and is called out as a limitation in Block B's
partitioning doc, not solved here.

**Response:**

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
| 4 | Gate assignment | `tickets[].gate_assignment` — always null today (see above), so this check currently always passes; wired for forward compatibility once real per-ticket assignment exists |

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
| `WRONG_GATE` | `gate_assignment` set and doesn't match this device's gate (currently unreachable — see above) |

## Block B (not built in Block A)

- **B2 reconciliation**: uploads write to the real `Attendance` table (currently
  zero rows, no routes). That table has no column for *why* a denial happened — only
  `status` (`admitted`/`denied`). Denial reason codes stay in the upload payload and
  the response, but are not persisted per-row unless a future migration adds one;
  noted here rather than silently dropped.
- **B3 partitioning**: documented above as a real limitation — a ticket holder can
  only be *authorized to admit* via any device registered for the event, not
  restricted to one specific gate, until real per-ticket assignment exists.
