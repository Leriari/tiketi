import { useState } from "react";
import { Download } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { SearchField, Table, EmptyState, ErrorState } from "../../components/ui";

export default function AuditLog() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const { data: rows, error, retry } = useApiData(() => api.getAuditLog({ query }), [query]);

  async function exportCsv() {
    try {
      await api.exportAuditLog({ query });
      toast.push("Audit log downloaded.", { tone: "success" });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't generate the export.", { tone: "danger" });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-h1 text-ink-primary">Audit Log</h1>
          <p className="text-body-sm text-ink-tertiary">Immutable record of every admin and organiser action across the platform.</p>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-brand-primary-on-tint">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <SearchField value={query} onChange={setQuery} placeholder="Search by action, target, or reason" className="max-w-sm" />

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No matching entries" description="Try a different search term." />}
        columns={[
          { key: "at", header: "Timestamp", render: (r) => <span className="tabular-nums">{new Date(r.at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> },
          { key: "actor_phone_masked", header: "Actor", render: (r) => r.actor_phone_masked || "—" },
          { key: "action", header: "Action", render: (r) => <span className="font-mono text-caption">{r.action}</span> },
          { key: "target_type", header: "Target", render: (r) => <span>{r.target_type} · {r.target_id ? r.target_id.slice(0, 10) : "—"}</span> },
          { key: "reason", header: "Reason / detail", render: (r) => r.reason || "—" },
        ]}
      />}
    </div>
  );
}
