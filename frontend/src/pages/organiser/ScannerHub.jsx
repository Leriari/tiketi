import { useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Table, Badge, Button, Modal, Select, Input, EmptyState, ErrorState } from "../../components/ui";

const STATUS_TONE = { invited: "warning", active: "success", revoked: "danger", expired: "neutral" };

function InviteModal({ events, onClose, onInvited }) {
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [gateId, setGateId] = useState(events[0]?.gates?.[0]?.id || "");
  const [deviceName, setDeviceName] = useState("");
  const [operatorPhone, setOperatorPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const event = events.find((e) => e.id === eventId);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.inviteScanner({ eventId, gateId, deviceName, operatorPhone });
      onInvited();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite scanner">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <Select label="Gate" value={gateId} onChange={(e) => setGateId(e.target.value)}>
          {event?.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <Input label="Device name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Gate A — Scanner 1" required />
        <Input label="Operator phone" value={operatorPhone} onChange={(e) => setOperatorPhone(e.target.value)} placeholder="0712 345 678" required hint="Sends a phone-OTP invite with this gate assignment." />
        <Button type="submit" loading={busy}>Send invite</Button>
      </form>
    </Modal>
  );
}

export default function ScannerHub() {
  const toast = useToast();
  const { data: events } = useApiData(() => api.getOrganiserEvents());
  const { data: devices, error, retry } = useApiData(() => api.getScannerDevices());
  const [inviteOpen, setInviteOpen] = useState(false);

  async function revoke(id) {
    await api.revokeScanner(id);
    toast.push("Scanner revoked.", { tone: "success" });
    retry();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-ink-primary">QR Scanner Hub</h1>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setInviteOpen(true)} className="w-auto px-4" disabled={!events?.length}>
          Invite scanner
        </Button>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={devices === null}
        data={devices || []}
        getRowId={(d) => d.id}
        empty={<EmptyState title="No scanner devices yet" description="Invite a gate operator's device to get started." actionLabel="Invite scanner" onAction={() => setInviteOpen(true)} />}
        columns={[
          { key: "device_name", header: "Device" },
          { key: "gate_name", header: "Gate" },
          { key: "event_title", header: "Event" },
          { key: "status", header: "Status", render: (d) => <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge> },
          { key: "last_sync_at", header: "Last sync", render: (d) => (d.last_sync_at ? new Date(d.last_sync_at).toLocaleTimeString("en-KE") : "—") },
          { key: "tickets_cached", header: "Cached", render: (d) => <span className="tabular-nums">{d.tickets_cached}</span> },
          { key: "total_scans", header: "Scans", render: (d) => <span className="tabular-nums">{d.total_scans}</span> },
          { key: "invalid_attempts", header: "Invalid", render: (d) => <span className="tabular-nums">{d.invalid_attempts}</span> },
        ]}
        rowActions={(d) => (d.status === "revoked" ? [] : [{ label: "Revoke", danger: true, onClick: async () => { if (window.confirm(`Revoke ${d.device_name}?`)) { try { await revoke(d.id); } catch (err) { toast.push(err instanceof ApiError ? err.message : "Couldn't revoke.", { tone: "danger" }); } } } }])}
      />}

      {inviteOpen && <InviteModal events={events || []} onClose={() => setInviteOpen(false)} onInvited={() => { setInviteOpen(false); toast.push("Invite sent.", { tone: "success" }); retry(); }} />}
    </div>
  );
}
