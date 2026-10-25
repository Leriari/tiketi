import { useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Table, Badge, Button, Modal, Select, Input, EmptyState, ErrorState } from "../../components/ui";

const ROLES = [
  { value: "super_admin", label: "Super Admin — full access" },
  { value: "support", label: "Support — read-only + broadcasts" },
  { value: "finance", label: "Finance — read-only + fee changes" },
  { value: "compliance", label: "Compliance — read-only + organiser and event reviews" },
];
// Every role can view every admin page; the label says what it can change.
// Admin users and feature flags are super admins' alone.

const STATUS_TONE = { invited: "warning", active: "success" };

function InviteModal({ onClose, onInvited }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(ROLES[1].value);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onInvited(await api.inviteAdminUser({ name, phone, role }));
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't send that invite.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite admin user">
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

export default function AdminUsers() {
  const toast = useToast();
  const { data: admins, error, retry } = useApiData(() => api.getAdminUsers());
  const [inviteOpen, setInviteOpen] = useState(false);

  async function remove(a) {
    if (!window.confirm(a.status === "invited" ? `Cancel the invite for ${a.name}?` : `Remove ${a.name} from platform admins?`)) return;
    try {
      await api.removeAdminUser(a.id);
      toast.push("Admin user removed.", { tone: "success" });
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't remove.", { tone: "danger" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-ink-primary">Admin Users</h1>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setInviteOpen(true)} className="w-auto px-4">Invite admin</Button>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={admins === null}
        data={admins || []}
        getRowId={(a) => a.id}
        empty={<EmptyState title="No admin users yet" description="Invite ChainTix staff to manage the platform." actionLabel="Invite admin" onAction={() => setInviteOpen(true)} />}
        columns={[
          { key: "name", header: "Name" },
          { key: "phone", header: "Phone", render: (a) => a.phone || "—" },
          { key: "role", header: "Role", render: (a) => ROLES.find((r) => r.value === a.role)?.label.split(" — ")[0] || a.role },
          { key: "status", header: "Status", render: (a) => <Badge tone={STATUS_TONE[a.status] || "neutral"}>{a.status}</Badge> },
          { key: "invited_at", header: "Since", render: (a) => <span className="tabular-nums">{new Date(a.invited_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
        ]}
        rowActions={(a) => (a.is_you || a.id === "admin-you" ? [] : [{ label: a.status === "invited" ? "Cancel invite" : "Remove", danger: true, onClick: () => remove(a) }])}
      />}

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onInvited={(admin) => {
        setInviteOpen(false);
        toast.push(admin?.status === "active" ? `${admin.name} is now an admin.` : "Invited. They become an admin the first time they sign in with that number.", { tone: "success" });
        retry();
      }} />}
    </div>
  );
}
