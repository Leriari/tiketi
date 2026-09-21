import { useEffect, useState } from "react";
import { api } from "../../api";
import { Table, MoneyText, EmptyState } from "../../components/ui";
import { formatEventDate } from "../../format";

/** Nav item "Sold History" — a filtered view of the same listings data My Listings' Sold tab shows. */
export default function SoldHistory() {
  const [listings, setListings] = useState(null);

  useEffect(() => {
    api.getMyListings().then((rows) => setListings(rows.filter((l) => l.status === "sold")));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Sold History</h1>
      <Table
        loading={listings === null}
        data={listings || []}
        getRowId={(l) => l.id}
        empty={<EmptyState title="Nothing sold yet" description="Tickets you sell will show up here once they're purchased." />}
        columns={[
          { key: "event", header: "Event", render: (l) => (
            <div><p className="font-medium text-ink-primary">{l.event_title}</p><p className="text-caption text-ink-tertiary">{formatEventDate(l.event_date)}</p></div>
          ) },
          { key: "tier_name", header: "Tier" },
          { key: "price", header: "Sold for", render: (l) => <MoneyText value={l.price} /> },
          { key: "payout_kes", header: "Payout", render: (l) => <MoneyText value={l.payout_kes} variant="positive" /> },
          { key: "sold_at", header: "Sold", render: (l) => <span className="tabular-nums">{new Date(l.sold_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> },
        ]}
      />
    </div>
  );
}
