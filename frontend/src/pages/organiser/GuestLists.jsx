import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Table, Badge, EmptyState, ErrorState } from "../../components/ui";

const STATUS_TONE = { active: "success", used: "neutral", cancelled: "danger" };

export default function GuestLists() {
  const { data: rows, error, retry } = useApiData(() => api.getGuestLists());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Guest Lists</h1>
      <p className="text-body-sm text-ink-tertiary">Every complimentary ticket you've sent, across all events — issue more from Control Center.</p>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.ticket_id}
        empty={<EmptyState title="No complimentary tickets yet" description="Send a comp ticket from Control Center to build your guest list." />}
        columns={[
          { key: "recipient_name", header: "Guest" },
          { key: "recipient_phone_masked", header: "Phone" },
          { key: "event_title", header: "Event" },
          { key: "tier_name", header: "Tier" },
          { key: "note", header: "Note", render: (r) => r.note || "—" },
          { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] || "neutral"}>{r.status}</Badge> },
          { key: "issued_at", header: "Issued", render: (r) => <span className="tabular-nums">{new Date(r.issued_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> },
        ]}
      />}
    </div>
  );
}
