"""
Per-ticket gate assignment (Work Order 05 B1).

No real per-ticket gate assignment existed — the sync payload's
`gate_assignment` field was present with nothing behind it (always null),
so every device registered for an event received the event's entire
ticket set, and two gates syncing the same event could both admit the
same ticket while offline.

Assignment is computed **by rule**, not stored at purchase time: a stable
hash of the ticket id, modulo the event's current set of registered
gates. Purchase-time assignment was considered and rejected — gates are
typically registered close to the event (Work Order 04 B4), often after
most tickets have already sold, so there would usually be no gates to
assign to yet at purchase time. A deterministic rule means every device
syncing for the same event independently computes the same assignment
for the same ticket without any stored column, and without needing to
know the gate list in advance.

**Limitation, stated plainly**: the assignment is only stable for as long
as the event's set of registered gates doesn't change. Registering a new
gate (or removing one) after some devices have already synced reshuffles
every ticket's assignment on the next sync, because the modulo base
changes. This is a real, known limitation of a computed-not-stored
scheme, not an oversight — see docs/offline-validation.md.
"""
import hashlib


def assign_gate(ticket_id: str, sorted_gate_names: list[str]) -> str | None:
    """
    Deterministic: the same ticket_id and the same sorted gate list always
    produce the same gate name. Callers must pass the gate list sorted
    (alphabetically, by convention) so every device computes it over the
    same ordering — an unsorted list would make the assignment depend on
    whatever order the caller's query happened to return rows in.
    """
    if not sorted_gate_names:
        return None
    digest = hashlib.sha256(ticket_id.encode()).hexdigest()
    index = int(digest, 16) % len(sorted_gate_names)
    return sorted_gate_names[index]
