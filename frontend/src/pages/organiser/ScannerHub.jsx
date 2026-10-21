import { useState } from "react";
import { Plus, KeyRound } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Table, Badge, Button, Modal, Select, Input, EmptyState, ErrorState, CopyButton } from "../../components/ui";

const STATUS_TONE = { invited: "warning", active: "success", revoked: "danger", expired: "neutral" };
const STATUS_LABEL = { invited: "awaiting enrolment", active: "active", revoked: "revoked", expired: "code expired" };

function RegisterModal({ events, onClose, onRegistered }) {
  const toast = useToast();
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const event = events.find((e) => e.id === eventId);
  const [gateName, setGateName] = useState(events[0]?.gates?.[0]?.name || "");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);

  function pickEvent(id) {
    setEventId(id);
    setGateName(events.find((e) => e.id === id)?.gates?.[0]?.name || "");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.inviteScanner({ eventId, gateName, deviceName });
      onRegistered({ ...res, deviceName, gateName, eventTitle: event?.title });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't register the device.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add a gate scanner">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select label="Event" value={eventId} onChange={(e) => pickEvent(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <Select label="Gate" value={gateName} onChange={(e) => setGateName(e.target.value)} hint="Gates come from the event's Gate Configuration.">
          {(event?.gates || []).map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
        </Select>
        <Input label="Device name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Gate A — Scanner 1" required />
        <Button type="submit" loading={busy} disabled={!gateName}>Get enrolment code</Button>
      </form>
    </Modal>
  );
}

function EnrolmentCodeModal({ device, onClose }) {
  return (
    <Modal open onClose={onClose} title="Enrol the device">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          On the gate phone for <strong className="text-ink-primary">{device.deviceName}</strong> ({device.gateName}
          {device.eventTitle ? `, ${device.eventTitle}` : ""}), open <span className="font-mono">/scanner</span> and enter this code:
        </p>
        <div className="flex items-center justify-center gap-3 rounded-md bg-surface-inset py-5">
          <KeyRound size={18} className="text-ink-tertiary" />
          <span className="text-h1 font-bold tracking-[0.2em] tabular-nums text-ink-primary">{device.enrollment_code}</span>
          <CopyButton value={device.enrollment_code} />
        </div>
        <p className="text-caption text-ink-tertiary">
          It works once and expires at {new Date(device.expires_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}.
          The device then syncs this gate's tickets and can scan with no internet.
        </p>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

export default function ScannerHub() {
  const toast = useToast();
  const { data: events } = useApiData(() => api.getOrganiserEvents());
  const { data: devices, error, retry } = useApiData(() => api.getScannerDevices());
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newDevice, setNewDevice] = useState(null);

  async function revoke(id) {
    await api.revokeScanner(id);
    toast.push("Scanner revoked. Its device can no longer sync or upload.", { tone: "success" });
    retry();
  }

  const liveEvents = (events || []).filter((e) => e.status !== "cancelled" && e.status !== "completed");

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-ink-primary">QR Scanner Hub</h1>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setRegisterOpen(true)} className="w-auto px-4" disabled={!liveEvents.length}>
          Add scanner
        </Button>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={devices === null}
        data={devices || []}
        getRowId={(d) => d.id}
        empty={<EmptyState title="No scanner devices yet" description="Add a scanner to get a one-time code for a gate phone." actionLabel="Add scanner" onAction={() => setRegisterOpen(true)} />}
        columns={[
          { key: "device_name", header: "Device" },
          { key: "gate_name", header: "Gate" },
          { key: "event_title", header: "Event" },
          { key: "status", header: "Status", render: (d) => <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status] || d.status}</Badge> },
          { key: "enrollment_code", header: "Code", render: (d) => (d.enrollment_code ? <span className="font-mono tabular-nums">{d.enrollment_code}</span> : "—") },
          { key: "last_sync_at", header: "Last sync", render: (d) => (d.last_sync_at ? new Date(d.last_sync_at).toLocaleTimeString("en-KE") : "—") },
          { key: "tickets_cached", header: "Gate tickets", render: (d) => <span className="tabular-nums">{d.tickets_cached}</span> },
          { key: "total_scans", header: "Scans", render: (d) => <span className="tabular-nums">{d.total_scans}</span> },
          { key: "invalid_attempts", header: "Invalid", render: (d) => <span className="tabular-nums">{d.invalid_attempts}</span> },
        ]}
        rowActions={(d) => (d.status === "revoked" ? [] : [{ label: "Revoke", danger: true, onClick: async () => { if (window.confirm(`Revoke ${d.device_name}?`)) { try { await revoke(d.id); } catch (err) { toast.push(err instanceof ApiError ? err.message : "Couldn't revoke.", { tone: "danger" }); } } } }])}
      />}

      {registerOpen && (
        <RegisterModal
          events={liveEvents}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(device) => { setRegisterOpen(false); setNewDevice(device); retry(); }}
        />
      )}
      {newDevice?.enrollment_code && <EnrolmentCodeModal device={newDevice} onClose={() => setNewDevice(null)} />}
    </div>
  );
}
