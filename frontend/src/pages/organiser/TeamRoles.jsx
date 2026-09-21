import { useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Table, Badge, Button, Modal, Select, Input, EmptyState, ErrorState } from "../../components/ui";

const ROLES = [
  { value: "manager", label: "Manager — full access" },
  { value: "finance", label: "Finance — wallet & payouts only" },
  { value: "gate_staff", label: "Gate staff — scanner & crowd control only" },
];

const STATUS_TONE = { invited: "warning", active: "success" };

function InviteModal({ onClose, onInvited }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(ROLES[0].value);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.inviteTeamMember({ name, phone, role });
      onInvited();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite team member">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" required />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Button type="submit" loading={busy}>Send invite</Button>
      </form>
    </Modal>
  );
}

export default function TeamRoles() {
  const toast = useToast();
  const { data: members, error, retry } = useApiData(() => api.getTeamMembers());
  const [inviteOpen, setInviteOpen] = useState(false);

  async function remove(id) {
    await api.removeTeamMember(id);
    toast.push("Team member removed.", { tone: "success" });
    retry();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-ink-primary">Team & Roles</h1>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setInviteOpen(true)} className="w-auto px-4">Invite member</Button>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={members === null}
        data={members || []}
        getRowId={(m) => m.id}
        empty={<EmptyState title="It's just you so far" description="Invite teammates to help manage events, finances, or gates." actionLabel="Invite member" onAction={() => setInviteOpen(true)} />}
        columns={[
          { key: "name", header: "Name" },
          { key: "phone", header: "Phone" },
          { key: "role", header: "Role", render: (m) => ROLES.find((r) => r.value === m.role)?.label.split(" — ")[0] || m.role },
          { key: "status", header: "Status", render: (m) => <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge> },
          { key: "invited_at", header: "Invited", render: (m) => <span className="tabular-nums">{new Date(m.invited_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> },
        ]}
        rowActions={(m) => [{ label: "Remove", danger: true, onClick: async () => { if (window.confirm(`Remove ${m.name} from your team?`)) { try { await remove(m.id); } catch (err) { toast.push(err instanceof ApiError ? err.message : "Couldn't remove.", { tone: "danger" }); } } } }]}
      />}

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onInvited={() => { setInviteOpen(false); toast.push("Invite sent.", { tone: "success" }); retry(); }} />}
    </div>
  );
}
