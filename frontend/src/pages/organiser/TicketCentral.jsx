import { useState } from "react";
import { Download, CheckSquare, RotateCcw } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { FilterBar, SearchField, Select, Table, Badge, Card, ErrorState } from "../../components/ui";

const STATUS_TONE = { active: "success", used: "neutral", cancelled: "danger", resale: "warning", pending_payment: "warning" };

function TimelineRow({ row }) {
  return (
    <Card className="flex flex-col gap-3">
      {row.suspicious.length > 0 && (
        <div className="rounded-sm bg-danger-bg text-danger px-3 py-2 text-caption font-medium">
          ⚠ {row.suspicious.join(" · ")}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {row.timeline.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-brand-primary flex-none" />
            <span className="text-body-sm text-ink-primary w-40 flex-none">{step.label}</span>
            <span className="text-caption text-ink-tertiary tabular-nums">{new Date(step.at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            {step.tx_hash && <span className="text-caption text-ink-tertiary font-mono truncate">{step.tx_hash.slice(0, 14)}…</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function TicketCentral() {
  const toast = useToast();
  const { data: events } = useApiData(() => api.getOrganiserEvents());
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  const { data: rows, error, retry } = useApiData(
    () => api.getTicketCentral({ eventId: eventId || undefined, status: status || undefined, query: query || undefined }),
    [eventId, status, query]
  );

  const active = Boolean(eventId || status || query);

  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Ticket Central</h1>

      <FilterBar active={active} onClear={() => { setEventId(""); setStatus(""); setQuery(""); }}>
        <SearchField value={query} onChange={setQuery} placeholder="Ticket ID or event" className="w-56" />
        <Select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-48" aria-label="Event">
          <option value="">All events</option>
          {(events || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status">
          <option value="">All statuses</option>
          {["active", "used", "resale", "cancelled", "pending_payment"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FilterBar>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-brand-primary/10 px-4 py-2.5">
          <span className="text-body-sm text-ink-primary font-medium">{selectedIds.length} selected</span>
          <button onClick={() => toast.push("CSV export isn't wired to a real file in this preview.", { tone: "info" })} className="inline-flex items-center gap-1 text-body-sm font-semibold text-brand-primary-on-tint"><Download size={14} /> Export CSV</button>
          <button onClick={() => toast.push("Void isn't reversible — skipped in this preview to avoid destructive mock actions.", { tone: "info" })} className="inline-flex items-center gap-1 text-body-sm font-semibold text-danger"><RotateCcw size={14} /> Void</button>
          <button onClick={() => toast.push("Credential resend isn't wired to real SMS/notifications in this preview.", { tone: "info" })} className="inline-flex items-center gap-1 text-body-sm font-semibold text-ink-secondary"><CheckSquare size={14} /> Resend credential</button>
        </div>
      )}

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.ticket_id}
        selectable
        selectedIds={selectedIds}
        onSelectedChange={setSelectedIds}
        onRowClick={(r) => setExpandedId(expandedId === r.ticket_id ? null : r.ticket_id)}
        columns={[
          { key: "ticket_id", header: "Ticket ID", render: (r) => <span className="font-mono text-caption">{r.ticket_id.slice(0, 8)}</span> },
          { key: "event_title", header: "Event" },
          { key: "tier_name", header: "Tier" },
          { key: "holder_phone_masked", header: "Holder" },
          { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] || "neutral"}>{r.status}</Badge> },
          { key: "purchased_at", header: "Purchased", render: (r) => (r.purchased_at ? <span className="tabular-nums">{new Date(r.purchased_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> : "—") },
          { key: "nft_token_id", header: "Token ID", render: (r) => (r.nft_token_id ? <span className="tabular-nums">#{r.nft_token_id}</span> : <span className="text-ink-tertiary">Minting…</span>) },
          { key: "gate_assignment", header: "Gate", render: (r) => r.gate_assignment || "—" },
          { key: "checked_in", header: "Checked in", render: (r) => (r.checked_in ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
        ]}
      />}

      {expandedId && rows && <TimelineRow row={rows.find((r) => r.ticket_id === expandedId)} />}
    </div>
  );
}
