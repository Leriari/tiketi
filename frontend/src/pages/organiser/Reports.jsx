import { FileText, Download } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function Reports() {
  const toast = useToast();
  const { data: rows, error, retry } = useApiData(() => api.getReports());

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Reports</h1>
      <p className="text-body-sm text-ink-tertiary">Auto-generated sales statements, one per event with sales.</p>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && rows === null && <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}

      {rows?.length === 0 && <EmptyState title="No reports yet" description="A sales statement generates automatically once an event has its first sale." />}

      {rows?.map((r) => (
        <Card key={r.id} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-md bg-brand-primary/10 text-brand-primary-on-tint flex items-center justify-center flex-none"><FileText size={16} /></span>
            <div>
              <p className="text-body-sm font-semibold text-ink-primary">{r.title}</p>
              <p className="text-caption text-ink-tertiary">Generated {new Date(r.generated_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          </div>
          <button onClick={() => toast.push("Report download isn't wired to a real file in this preview.", { tone: "info" })} className="inline-flex items-center gap-1 text-caption font-semibold text-brand-primary-on-tint flex-none">
            <Download size={13} /> Download
          </button>
        </Card>
      ))}
    </div>
  );
}
