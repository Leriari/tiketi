import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Select, Button, Table, Badge, EmptyState, ErrorState } from "../../components/ui";

const EXPORT_TYPES = [
  { value: "ticket_sales", label: "Ticket sales" },
  { value: "attendance", label: "Attendance" },
  { value: "royalty_ledger", label: "Royalty ledger" },
  { value: "payouts", label: "Payout history" },
];

export default function ExportCentre() {
  const toast = useToast();
  const { data: rows, error, retry } = useApiData(() => api.getExports());
  const [type, setType] = useState(EXPORT_TYPES[0].value);
  const [format, setFormat] = useState("csv");
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    try {
      await api.requestExport({ type, format });
      toast.push("Export ready.", { tone: "success" });
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't generate that export.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Export Centre</h1>

      <Card className="flex flex-col sidebar:flex-row items-end gap-3">
        <Select label="Data" value={type} onChange={(e) => setType(e.target.value)} className="flex-1">
          {EXPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="w-32">
          <option value="csv">CSV</option>
          <option value="pdf">PDF</option>
        </Select>
        <Button onClick={request} loading={busy} iconLeft={<FileSpreadsheet size={15} />} className="w-auto px-5">Generate export</Button>
      </Card>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No exports yet" description="Generate your first export above." />}
        columns={[
          { key: "type", header: "Data", render: (r) => EXPORT_TYPES.find((t) => t.value === r.type)?.label || r.type },
          { key: "format", header: "Format", render: (r) => <span className="uppercase">{r.format}</span> },
          { key: "status", header: "Status", render: (r) => <Badge tone="success">{r.status}</Badge> },
          { key: "requested_at", header: "Requested", render: (r) => <span className="tabular-nums">{new Date(r.requested_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> },
          { key: "download", header: <span className="sr-only">Download</span>, render: (r) => (
            <button
              onClick={async () => {
                try {
                  await api.downloadExport(r.id);
                } catch (err) {
                  toast.push(err instanceof ApiError ? err.message : "Couldn't download that export.", { tone: "danger" });
                }
              }}
              className="inline-flex items-center gap-1 text-caption font-semibold text-brand-primary-on-tint"
            >
              <Download size={13} /> Download
            </button>
          ) },
        ]}
      />}
    </div>
  );
}
