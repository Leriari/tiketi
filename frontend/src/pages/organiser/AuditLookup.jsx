import { useState } from "react";
import { Search, AlertTriangle } from "lucide-react";
import { api } from "../../api";
import { SearchField, Card, Badge, EmptyState, Skeleton } from "../../components/ui";
import { CONTRACT_DEPLOYED } from "../../constants";

const STATUS_TONE = { active: "success", used: "neutral", cancelled: "danger", resale: "warning", pending_payment: "warning" };

export default function AuditLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searched, setSearched] = useState(false);

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setResults(null);
    setSearched(true);
    setResults(await api.auditLookup(query));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Ticket Audit Lookup</h1>
      <p className="text-body-sm text-ink-tertiary">Search by ticket ID, holder phone, or M-Pesa receipt number.</p>

      {!CONTRACT_DEPLOYED && (
        <div className="rounded-md bg-warning-bg text-warning-on-tint px-4 py-2.5 text-body-sm flex items-start gap-2">
          <AlertTriangle size={16} className="flex-none mt-0.5" />
          <span><strong className="font-semibold">Simulated data.</strong> No smart contract is deployed. Any transaction hash shown below is illustrative and does not reflect on-chain state.</span>
        </div>
      )}

      <form onSubmit={search} className="flex gap-2">
        <SearchField value={query} onChange={setQuery} placeholder="e.g. a1b2c3d4, 0712345678, OEI2AK4MFU" className="flex-1" />
        <button type="submit" className="rounded-sm bg-brand-accent text-brand-accent-ink px-4 font-semibold inline-flex items-center gap-1.5"><Search size={15} /> Search</button>
      </form>

      {results === null && searched && (
        <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      )}

      {results?.length === 0 && <EmptyState title="No matches" description="Try a different ticket ID, phone number, or receipt." />}

      {results?.map((r) => (
        <Card key={r.ticket_id} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-caption text-ink-tertiary">#{r.ticket_id}</p>
              <p className="text-h3 text-ink-primary">{r.event_title}</p>
            </div>
            <Badge tone={STATUS_TONE[r.status] || "neutral"}>{r.status}</Badge>
          </div>

          {r.suspicious.length > 0 && (
            <div className="rounded-sm bg-danger-bg text-danger-on-tint px-3 py-2 text-caption font-medium flex items-center gap-1.5">
              <AlertTriangle size={13} /> {r.suspicious.join(" · ")}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
            {r.timeline.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-brand-primary flex-none" />
                <span className="text-body-sm text-ink-primary w-40 flex-none">{step.label}</span>
                <span className="text-caption text-ink-tertiary tabular-nums">
                  {new Date(step.at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-caption text-ink-tertiary">· {r.holder_name ? `${r.holder_name}, ` : ""}{r.holder_phone_masked}</span>
                {step.tx_hash && <span className="text-caption text-ink-tertiary font-mono truncate">{step.tx_hash.slice(0, 14)}…</span>}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
