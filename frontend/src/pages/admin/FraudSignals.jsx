import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, Badge, EmptyState, ErrorState, Skeleton } from "../../components/ui";

function Panel({ title, description, children, empty }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">{title}</span>
        <p className="text-caption text-ink-tertiary">{description}</p>
      </div>
      {children ?? <p className="text-body-sm text-ink-tertiary">{empty}</p>}
    </div>
  );
}

export default function FraudSignals() {
  const { data, error, retry } = useApiData(() => api.getFraudSignals());

  if (error) return <div className="mx-auto max-w-4xl px-4 py-6"><ErrorState description={error} onRetry={retry} /></div>;
  if (!data) return <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  const totalFlags = data.repeatedFailedScans.length + data.unusualVelocity.length + data.duplicateDevices.length;

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <div>
        <h1 className="text-h1 text-ink-primary">Fraud Signals</h1>
        <p className="text-body-sm text-ink-tertiary">Patterns worth a closer look, computed from real gate scans, listings, and scanner devices — nothing here is simulated.</p>
      </div>

      {totalFlags === 0 && <EmptyState title="Nothing flagged" description="No unusual patterns detected right now." />}

      <Panel title="Repeated failed scans" description="Tickets denied 3 or more times — a possible counterfeit or a confused attendee." empty="No tickets with repeated denials.">
        {data.repeatedFailedScans.length > 0 && (
          <Card padding="p-0">
            {data.repeatedFailedScans.map((r, i) => (
              <div key={r.ticket_id} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                <div>
                  <p className="font-mono text-caption text-ink-tertiary">#{r.ticket_id.slice(0, 8)}</p>
                  <p className="text-body-sm text-ink-primary">{r.event_title}</p>
                </div>
                <Badge tone="danger">{r.denied_count} denials</Badge>
              </div>
            ))}
          </Card>
        )}
      </Panel>

      <Panel title="Unusual resale velocity" description="Sellers with 3 or more active or sold listings — could be a legitimate power-seller, or scalping." empty="No unusual seller activity.">
        {data.unusualVelocity.length > 0 && (
          <Card padding="p-0">
            {data.unusualVelocity.map((r, i) => (
              <div key={r.phone_masked + i} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                <span className="text-body-sm text-ink-primary">{r.phone_masked}</span>
                <Badge tone="warning">{r.listing_count} listings</Badge>
              </div>
            ))}
          </Card>
        )}
      </Panel>

      <Panel title="Duplicate device fingerprints" description="The same scanner device name registered at more than one event." empty="No duplicate devices detected.">
        {data.duplicateDevices.length > 0 && (
          <Card padding="p-0">
            {data.duplicateDevices.map((r, i) => (
              <div key={r.device_name} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                <span className="text-body-sm text-ink-primary">{r.device_name}</span>
                <Badge tone="warning">{r.event_count} events</Badge>
              </div>
            ))}
          </Card>
        )}
      </Panel>
    </div>
  );
}
