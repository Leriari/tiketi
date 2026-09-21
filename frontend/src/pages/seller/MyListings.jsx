import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError, usingMockBackend } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Tabs, Table, Badge, MoneyText, Button, Modal, Input } from "../../components/ui";
import { formatEventDate } from "../../format";

const STATUS_TONE = { pending_review: "warning", active: "success", sold: "brand", paused: "warning", cancelled: "danger", expired: "neutral" };
const STATUS_LABEL = { pending_review: "Pending Review", active: "Active", sold: "Sold", paused: "Paused", cancelled: "Cancelled", expired: "Expired" };
const TABS = ["active", "pending_review", "sold", "paused", "cancelled", "expired"];

function RepriceModal({ listing, onClose, onSaved }) {
  const [price, setPrice] = useState(listing.price);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.repriceListing(listing.id, { price: Number(price) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the price.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={listing.status === "paused" ? "Reprice and relist" : "Edit price"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          Allowed range: <MoneyText value={listing.resale_floor_kes} size="body" /> – <MoneyText value={listing.resale_ceiling_kes} size="body" />
        </p>
        <Input
          label="New price (KES)"
          type="number"
          min={listing.resale_floor_kes}
          max={listing.resale_ceiling_kes}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        {error && <p className="text-body-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy}>Save</Button>
      </form>
    </Modal>
  );
}

export default function MyListings() {
  const toast = useToast();
  const [tab, setTab] = useState("active");
  const [listings, setListings] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [repricing, setRepricing] = useState(null);

  function load() {
    api.getMyListings().then((rows) => {
      setListings(rows);
      setSelectedIds([]);
    });
  }
  useEffect(load, []);

  async function act(fn, id, successMsg) {
    try {
      await fn(id);
      toast.push(successMsg, { tone: "success" });
      load();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Something went wrong.", { tone: "danger" });
    }
  }

  async function bulkAct(fn, successMsg) {
    await Promise.all(selectedIds.map((id) => fn(id).catch(() => {})));
    toast.push(successMsg, { tone: "success" });
    load();
  }

  const counts = TABS.reduce((acc, t) => {
    acc[t] = listings?.filter((l) => l.status === t).length;
    return acc;
  }, {});
  const rows = listings?.filter((l) => l.status === tab) || [];

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">My Listings</h1>

      <Tabs
        items={TABS.map((t) => ({ value: t, label: STATUS_LABEL[t], count: counts[t] }))}
        value={tab}
        onChange={setTab}
        className="max-w-2xl overflow-x-auto"
      />

      {selectedIds.length > 0 && (tab === "active" || tab === "paused") && (
        <div className="flex items-center gap-3 rounded-md bg-brand-primary/10 px-4 py-2.5">
          <span className="text-body-sm text-ink-primary font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="secondary" onClick={() => bulkAct(api.pauseListing, "Listings paused.")}>Pause</Button>
          <Button size="sm" variant="danger" onClick={() => bulkAct(api.cancelListing, "Listings cancelled.")}>Cancel</Button>
        </div>
      )}

      <Table
        loading={listings === null}
        data={rows}
        getRowId={(l) => l.id}
        selectable
        selectedIds={selectedIds}
        onSelectedChange={setSelectedIds}
        empty={
          <div className="text-center py-16 text-ink-secondary">
            <p className="text-h3 text-ink-primary mb-1">{tab === "active" ? "No active listings" : `No ${STATUS_LABEL[tab].toLowerCase()} listings`}</p>
            <p className="text-body-sm">{tab === "active" && "List a ticket to get started."}</p>
          </div>
        }
        columns={[
          {
            key: "event",
            header: "Event",
            render: (l) => (
              <div>
                <p className="font-medium text-ink-primary">{l.event_title}</p>
                <p className="text-caption text-ink-tertiary">{formatEventDate(l.event_date)}</p>
              </div>
            ),
          },
          { key: "tier_name", header: "Tier" },
          { key: "price", header: "Listed price", render: (l) => <MoneyText value={l.price} /> },
          { key: "payout_kes", header: "Your payout", render: (l) => <MoneyText value={l.payout_kes} variant="positive" /> },
          { key: "views", header: "Views", render: (l) => <span className="tabular-nums">{l.views}</span> },
          {
            key: "status",
            header: "Status",
            render: (l) => (
              <div className="flex flex-col gap-1">
                <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                {l.status === "paused" && l.pause_reason && <p className="text-caption text-warning max-w-[220px]">{l.pause_reason}</p>}
              </div>
            ),
          },
        ]}
        rowActions={(l) => {
          const items = [];
          if (l.status === "active") {
            items.push({ label: "Edit price", onClick: () => setRepricing(l) });
            items.push({ label: "Pause listing", onClick: () => act(api.pauseListing, l.id, "Listing paused.") });
            if (usingMockBackend) {
              items.push({ label: "Simulate a sale (dev)", icon: <Sparkles size={14} />, onClick: () => act(api.devSimulateSale, l.id, "Sold! Funds added to Pending.") });
            }
          }
          if (l.status === "paused") {
            items.push({ label: "Reprice and relist", onClick: () => setRepricing(l) });
          }
          if (["active", "paused", "pending_review"].includes(l.status)) {
            items.push({ label: "Cancel listing", danger: true, onClick: () => act(api.cancelListing, l.id, "Listing cancelled.") });
          }
          items.push({ label: "View public listing", onClick: () => toast.push("The public resale marketplace page isn't built yet — that's an Attendee-side Phase 6 feature.", { tone: "info" }) });
          return items;
        }}
      />

      {repricing && <RepriceModal listing={repricing} onClose={() => setRepricing(null)} onSaved={() => { setRepricing(null); toast.push("Price updated.", { tone: "success" }); load(); }} />}
    </div>
  );
}
