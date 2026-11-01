import { useState } from "react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { PAYOUT_STATUS } from "../../lib/payouts";
import { useToast } from "../../components/ui/Toast";
import { Table, Badge, MoneyText, EmptyState, ErrorState, Tabs, Modal, Input, Button, Card } from "../../components/ui";

const TYPE_TONE = { seller: "info", organiser: "brand" };
const VIEWS = {
  waiting: { label: "Needs approval", statuses: ["pending_approval"] },
  sending: { label: "In progress", statuses: ["processing"] },
  done: { label: "Done", statuses: ["paid", "failed", "rejected"] },
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

// One modal for the three actions that need a typed answer.
const PROMPTS = {
  reject: { title: "Reject payout", label: "Reason (shown to the recipient)", button: "Reject and return the money", call: (id, v) => api.rejectPayout({ id, reason: v }) },
  paid: { title: "Mark as paid", label: "M-Pesa receipt", button: "Mark paid", placeholder: "SG632NMUAB", call: (id, v) => api.markPayoutPaid({ id, receipt: v }) },
  failed: { title: "Mark as failed", label: "What you checked (shown to the recipient)", button: "Mark failed and return the money", call: (id, v) => api.markPayoutFailed({ id, reason: v }) },
};

function PromptModal({ kind, payout, onClose, onDone }) {
  const prompt = PROMPTS[kind];
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await prompt.call(payout.id, value.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={prompt.title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          <MoneyText value={payout.amount_kes} size="body" /> to {payout.recipient}, {payout.destination}
          {kind === "paid" && <> (they receive <MoneyText value={payout.net_kes} size="body" />)</>}
        </p>
        {kind === "failed" && (
          <p className="text-caption text-ink-tertiary">Only do this once you&apos;ve confirmed in the M-Pesa business portal that the money never left.</p>
        )}
        <Input label={prompt.label} value={value} onChange={(e) => setValue(e.target.value)} placeholder={prompt.placeholder} required />
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} variant={kind === "paid" ? "primary" : "danger"}>{prompt.button}</Button>
      </form>
    </Modal>
  );
}

function PayoutRequests() {
  const toast = useToast();
  const { data, error, retry } = useApiData(() => api.getPayoutRequests());
  const [view, setView] = useState("waiting");
  const [prompt, setPrompt] = useState(null);

  async function act(promise, message) {
    try {
      const payout = await promise;
      toast.push(payout?.status === "failed" ? `M-Pesa didn't take it: ${payout.note}` : message, { tone: payout?.status === "failed" ? "danger" : "success" });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "That didn't work.", { tone: "danger" });
    }
    retry();
  }

  if (error) return <ErrorState description={error} onRetry={retry} />;
  const rows = data?.requests || [];
  const shown = rows.filter((r) => VIEWS[view].statuses.includes(r.status));

  return (
    <div className="flex flex-col gap-3">
      {data && (
        <Card className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
          <span className="text-ink-secondary">
            {data.automatic
              ? "Approved payouts go out through M-Pesa (B2C to phones, B2B to paybills and tills)."
              : "M-Pesa payouts aren't set up on this server: pay each one from the M-Pesa business app, then mark it paid with the receipt."}
          </span>
          {data.payoutAccountBalance && (
            <span className="text-ink-secondary">
              B2C account balance <MoneyText value={Number(data.payoutAccountBalance.kes)} className="font-semibold" />{" "}
              <span className="text-caption text-ink-tertiary">as of {formatDate(data.payoutAccountBalance.as_of)}</span>
            </span>
          )}
        </Card>
      )}
      <Tabs
        value={view}
        onChange={setView}
        items={Object.entries(VIEWS).map(([value, v]) => ({ value, label: v.label, count: rows.filter((r) => v.statuses.includes(r.status)).length }))}
      />
      <Table
        loading={!data}
        data={shown}
        getRowId={(r) => r.id}
        empty={<EmptyState title="Nothing here" description={view === "waiting" ? "No payouts are waiting for approval." : "No payouts in this list."} />}
        columns={[
          { key: "type", header: "Type", render: (r) => <Badge tone={TYPE_TONE[r.recipient_type]}>{r.recipient_type}</Badge> },
          { key: "recipient", header: "Recipient", render: (r) => <div><p>{r.recipient}</p><p className="text-caption text-ink-tertiary">{r.destination}</p></div> },
          { key: "amount_kes", header: "Amount", render: (r) => <div><MoneyText value={r.amount_kes} /><p className="text-caption text-ink-tertiary">sends <MoneyText value={r.net_kes} size="caption" /></p></div> },
          { key: "created_at", header: "Requested", render: (r) => <span className="tabular-nums">{formatDate(r.created_at)}</span> },
          {
            key: "status", header: "Status", render: (r) => (
              <div className="flex flex-col gap-0.5 items-start max-w-xs">
                <Badge tone={PAYOUT_STATUS[r.status]?.tone}>{PAYOUT_STATUS[r.status]?.label}</Badge>
                {r.mpesa_receipt && <span className="font-mono text-caption">{r.mpesa_receipt}{r.manual ? " · paid by hand" : ""}</span>}
                {r.note && r.status !== "paid" && <span className="text-caption text-ink-tertiary">{r.note}</span>}
              </div>
            ),
          },
        ]}
        rowActions={(r) => {
          if (r.status === "pending_approval") {
            return [
              ...(data?.automatic ? [{ label: "Approve and send", onClick: () => act(api.approvePayout(r.id), "Sent to M-Pesa.") }] : []),
              { label: "Mark paid (paid by hand)", onClick: () => setPrompt({ kind: "paid", payout: r }) },
              { label: "Reject", danger: true, onClick: () => setPrompt({ kind: "reject", payout: r }) },
            ];
          }
          if (r.status === "processing") {
            return [
              { label: "Check status with M-Pesa", onClick: () => act(api.checkPayoutStatus(r.id), "Asked M-Pesa. Its answer will update this payout.") },
              { label: "Mark paid", onClick: () => setPrompt({ kind: "paid", payout: r }) },
              { label: "Mark failed", danger: true, onClick: () => setPrompt({ kind: "failed", payout: r }) },
            ];
          }
          return [{ label: "No actions", disabled: true }];
        }}
      />
      {prompt && (
        <PromptModal
          kind={prompt.kind}
          payout={prompt.payout}
          onClose={() => setPrompt(null)}
          onDone={() => { setPrompt(null); toast.push("Payout updated.", { tone: "success" }); retry(); }}
        />
      )}
    </div>
  );
}

function Escrow() {
  const { data: rows, error, retry } = useApiData(() => api.getPayoutQueue());
  const total = (rows || []).reduce((s, r) => s + r.amount_kes, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-h3 text-ink-primary">Held in escrow</h2>
          <p className="text-body-sm text-ink-tertiary">Earnings not yet released to sellers and organisers, soonest release first.</p>
        </div>
        {rows && rows.length > 0 && <p className="text-body-sm text-ink-secondary">Total held <MoneyText value={total} className="font-semibold text-ink-primary" /></p>}
      </div>
      {error ? <ErrorState description={error} onRetry={retry} /> : (
        <Table
          loading={rows === null}
          data={rows || []}
          getRowId={(r) => r.id}
          empty={<EmptyState title="Nothing in escrow" description="Nothing is currently held awaiting release." />}
          columns={[
            { key: "type", header: "Type", render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> },
            { key: "recipient", header: "Recipient" },
            { key: "description", header: "Description" },
            { key: "amount_kes", header: "Amount", render: (r) => <MoneyText value={r.amount_kes} variant="pending" /> },
            { key: "available_at", header: "Releases", render: (r) => <span className="tabular-nums">{new Date(r.available_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
          ]}
        />
      )}
    </div>
  );
}

export default function PayoutQueue() {
  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-h1 text-ink-primary">Payout Queue</h1>
          <p className="text-body-sm text-ink-tertiary">Seller withdrawals and organiser payout requests. Approving, rejecting and marking payouts needs the finance role.</p>
        </div>
        <PayoutRequests />
      </div>
      <Escrow />
    </div>
  );
}
