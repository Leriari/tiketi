import { useState } from "react";
import { CheckCircle2, XCircle, Ban, RotateCcw } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Badge, Button, Modal, Textarea, Table, EmptyState, ErrorState, Skeleton } from "../../components/ui";

const STATUS_TONE = { pending: "warning", verified: "success", suspended: "danger", rejected: "neutral" };

function DecisionModal({ org, decision, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requiresReason = decision === "rejected" || decision === "suspended";

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (decision === "suspended") {
        await api.suspendOrganiser({ id: org.id, reason });
      } else {
        await api.reviewOrganiser({ id: org.id, decision, reason: reason || undefined });
      }
      toast.push(decision === "verified" ? "Organiser verified." : decision === "rejected" ? "Organiser rejected." : "Organiser suspended.", { tone: decision === "verified" ? "success" : "danger" });
      onDone();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't save that.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const titles = { verified: "Verify organiser", rejected: "Reject organiser", suspended: "Suspend organiser" };

  return (
    <Modal open onClose={onClose} title={titles[decision]}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">{org.business_name}</p>
        <Textarea
          label="Reason"
          required={requiresReason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={requiresReason ? "Explain why, for the audit log" : "Optional note"}
        />
        <Button type="submit" variant={decision === "verified" ? "primary" : "danger"} loading={busy}>Confirm</Button>
      </form>
    </Modal>
  );
}

export default function OrganiserAccounts() {
  const toast = useToast();
  const { data: orgs, error, retry } = useApiData(() => api.getPlatformOrganisers());
  const [action, setAction] = useState(null); // { org, decision }

  async function reinstate(org) {
    if (!window.confirm(`Reinstate ${org.business_name}?`)) return;
    try {
      await api.reinstateOrganiser(org.id);
      toast.push("Organiser reinstated.", { tone: "success" });
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't reinstate.", { tone: "danger" });
    }
  }

  const pending = orgs?.filter((o) => o.status === "pending") || [];

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <h1 className="text-h1 text-ink-primary">Organiser Accounts</h1>

      <div className="flex flex-col gap-3">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Verification queue</span>
        {error ? (
          <ErrorState description={error} onRetry={retry} />
        ) : orgs === null ? (
          <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
        ) : pending.length === 0 ? (
          <EmptyState title="Nothing to verify" description="New organiser sign-ups needing document review will show up here." />
        ) : (
          pending.map((org) => (
            <Card key={org.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-h3 text-ink-primary">{org.business_name}</p>
                  <p className="text-caption text-ink-tertiary">Registered {new Date(org.registered_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <Badge tone="warning">Pending review</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-body-sm">
                <div><span className="text-ink-tertiary">KRA PIN</span><p className="font-mono text-ink-primary">{org.kra_pin}</p></div>
                <div><span className="text-ink-tertiary">Contact</span><p className="text-ink-primary">{org.contact_email} · {org.contact_phone}</p></div>
              </div>
              <p className="text-body-sm text-ink-secondary bg-surface-inset rounded-sm px-3 py-2">{org.doc_note}</p>
              <div className="flex gap-2">
                <Button iconLeft={<CheckCircle2 size={15} />} onClick={() => setAction({ org, decision: "verified" })} className="flex-1">Verify</Button>
                <Button variant="danger" iconLeft={<XCircle size={15} />} onClick={() => setAction({ org, decision: "rejected" })} className="flex-1">Reject</Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {!error && <div className="flex flex-col gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">All organisers</span>
        <Table
          loading={orgs === null}
          data={orgs || []}
          getRowId={(o) => o.id}
          columns={[
            { key: "business_name", header: "Business" },
            { key: "contact_email", header: "Contact" },
            { key: "status", header: "Status", render: (o) => <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge> },
            { key: "registered_at", header: "Registered", render: (o) => <span className="tabular-nums">{new Date(o.registered_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
          ]}
          rowActions={(o) => {
            if (o.status === "verified") return [{ label: "Suspend", danger: true, icon: <Ban size={14} />, onClick: () => setAction({ org: o, decision: "suspended" }) }];
            if (o.status === "suspended") return [{ label: "Reinstate", icon: <RotateCcw size={14} />, onClick: () => reinstate(o) }];
            return [];
          }}
        />
      </div>}

      {action && (
        <DecisionModal
          org={action.org}
          decision={action.decision}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); retry(); }}
        />
      )}
    </div>
  );
}
