import { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Input, Button, ErrorState, Skeleton } from "../../components/ui";

export default function OrganisationProfile() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { data: form, setData: setForm, error, retry } = useApiData(() => api.getOrganiserProfile());
  const [busy, setBusy] = useState(false);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateOrganiserProfile(form);
      toast.push("Organisation profile saved.", { tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="mx-auto max-w-lg px-4 py-6"><ErrorState description={error} onRetry={retry} /></div>;
  if (!form) return <div className="mx-auto max-w-lg px-4 py-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Organisation Profile</h1>

      <form onSubmit={save} className="card flex flex-col gap-4">
        <Input label="Business name" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required />
        <Input label="KRA PIN" value={form.kraPin} onChange={(e) => set("kraPin", e.target.value)} placeholder="P051234567X" />
        <Input label="Contact email" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
        <Input label="Contact phone" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="0712 345 678" />
        <Button type="submit" loading={busy}>Save changes</Button>
      </form>

      <Card className="flex items-center justify-between">
        <div>
          <p className="text-body-sm font-semibold text-ink-primary">{user?.phoneNumber}</p>
          <p className="text-caption text-ink-tertiary">Signed in</p>
        </div>
        <button onClick={logout} className="text-body-sm font-semibold text-danger">Log out</button>
      </Card>
    </div>
  );
}
