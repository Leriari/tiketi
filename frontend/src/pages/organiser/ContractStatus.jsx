import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Select, Card, StatCard, ChainBadge, ProgressBar, CopyButton, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { CONTRACT_DEPLOYED } from "../../constants";

export default function ContractStatus() {
  const { data: events, error: eventsError, retry: retryEvents } = useApiData(() => api.getOrganiserEvents());
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    if (events?.[0] && !eventId) setEventId(events[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const { data, error, retry } = useApiData(() => (eventId ? api.getContractStatus(eventId) : Promise.resolve(null)), [eventId]);

  if (eventsError) {
    return <div className="mx-auto max-w-4xl px-4 py-10"><ErrorState description={eventsError} onRetry={retryEvents} /></div>;
  }

  if (events === null) {
    return <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6"><Skeleton className="h-20 w-full" /></div>;
  }

  if (events.length === 0) {
    return <div className="mx-auto max-w-4xl px-4 py-10"><EmptyState title="No events yet" description="Deploy an event to see its on-chain contract status here." /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-ink-primary">Contract Status</h1>
        <Select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-56" aria-label="Event">
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
      </div>

      {!CONTRACT_DEPLOYED && (
        <div className="rounded-md bg-warning-bg text-warning-on-tint px-4 py-2.5 text-body-sm flex items-start gap-2">
          <AlertTriangle size={16} className="flex-none mt-0.5" />
          <span><strong className="font-semibold">Simulated data.</strong> No smart contract is deployed. The values on this page are illustrative and do not reflect on-chain state.</span>
        </div>
      )}

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-body-sm text-ink-tertiary">{data.event_title}</p>
                <p className="font-mono text-body text-ink-primary flex items-center gap-2">
                  {data.contract_address}
                  <CopyButton value={data.contract_address} />
                </p>
              </div>
              <ChainBadge status="verified" txUrl={`https://sepolia.basescan.org/address/${data.contract_address}`} />
            </div>
            <p className="text-caption text-ink-tertiary">
              {data.network}
              {data.deployed_at && ` · deployed ${new Date(data.deployed_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}`}
              {data.blockchain_configured === false && " · minting is not configured on the server"}
            </p>
          </Card>

          <div className="grid grid-cols-2 sidebar:grid-cols-4 gap-3">
            <StatCard label="Resale cap" value={`${data.resale_cap_percent}%`} />
            <StatCard label="Royalty" value={`${data.royalty_percent}%`} />
            <StatCard label="Avg. gas cost" value={data.avg_gas_cost_usd == null ? "Not tracked" : `$${data.avg_gas_cost_usd.toFixed(3)}`} />
            <StatCard label="Pending mints" value={data.pending_mints} />
          </div>

          <Card className="flex flex-col gap-2">
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>Mint success rate</span>
              <span className="tabular-nums text-ink-primary font-semibold">{data.total_minted} minted · {data.mint_success_rate}%</span>
            </div>
            <ProgressBar value={data.mint_success_rate} max={100} ariaLabel="Mint success rate" />
          </Card>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Failed mint queue</span>
            {data.failed_mint_queue.length === 0 ? (
              <p className="text-body-sm text-ink-tertiary">No failed mints — every purchase has confirmed on-chain successfully.</p>
            ) : (
              <Card padding="p-0">
                {data.failed_mint_queue.map((f, i) => (
                  <div key={i} className={`px-4 py-3 ${i > 0 ? "border-t border-line-subtle" : ""}`}>{f.reason}</div>
                ))}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
