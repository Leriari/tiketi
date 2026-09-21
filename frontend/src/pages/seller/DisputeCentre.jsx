import { useState } from "react";
import { AlertCircle, Paperclip } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, MoneyText, EmptyState, ErrorState, Skeleton, Tabs } from "../../components/ui";

const STEPS = ["Raised", "Under review", "Resolved"];

function DisputeDetail({ dispute }) {
  const stepIndex = STEPS.findIndex((s) => s.toLowerCase().replace(" ", "_") === dispute.status);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-h3 text-ink-primary">{dispute.subject}</h3>
        <MoneyText value={dispute.amount_held} />
      </div>
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${i <= stepIndex ? "bg-brand-primary" : "bg-line-strong"}`} />
            <span className={`text-caption ${i <= stepIndex ? "text-ink-primary" : "text-ink-tertiary"}`}>{s}</span>
            {i < STEPS.length - 1 && <span className="w-6 h-px bg-line-strong" />}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
        {dispute.messages.map((m, i) => (
          <div key={i} className="text-body-sm">
            <span className="font-semibold text-ink-primary">{m.from}: </span>
            <span className="text-ink-secondary">{m.text}</span>
          </div>
        ))}
      </div>
      <button className="flex items-center gap-1.5 text-body-sm text-brand-primary-on-tint w-fit">
        <Paperclip size={14} /> Attach evidence
      </button>
    </Card>
  );
}

export default function DisputeCentre() {
  const [tab, setTab] = useState("open");
  const { data: disputes, error, retry } = useApiData(() => api.getDisputes());

  const rows = disputes?.filter((d) => (tab === "open" ? d.status !== "resolved" : d.status === "resolved")) || [];

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Dispute Centre</h1>
      <Tabs items={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }]} value={tab} onChange={setTab} className="max-w-xs" />

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && !disputes && <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>}

      {disputes && rows.length === 0 && (
        <EmptyState
          icon={<AlertCircle size={20} />}
          title={tab === "open" ? "No open disputes" : "No resolved disputes"}
          description="If a buyer raises an issue with a sale, it'll show up here with a message thread and the amount held in escrow."
        />
      )}

      <div className="flex flex-col gap-3">
        {rows.map((d) => <DisputeDetail key={d.id} dispute={d} />)}
      </div>
    </div>
  );
}
