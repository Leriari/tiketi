import { ShieldAlert } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { StatCard, Card, MoneyText, ErrorState, Skeleton } from "../../components/ui";

export default function ResaleCompliance() {
  const { data, error, retry } = useApiData(() => api.getResaleCompliance());

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Resale Compliance</h1>
      <p className="text-body-sm text-ink-tertiary">How well your resale price caps are being enforced across all listings, by ChainTix's own checks before a listing goes live.</p>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && !data && <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Blocked over-cap attempts" value={data.rejectedAboveCapAttempts} hint="Sellers who tried to list above your cap — rejected before publishing." />
            <StatCard label="Listings paused by a cap change" value={data.listingsPausedByCapChange} hint="Auto-paused when you lowered a cap below the listed price." />
          </div>

          {data.rejectedAboveCapAttempts === 0 && data.listingsPausedByCapChange === 0 && (
            <Card className="flex items-center gap-3 bg-success-bg">
              <ShieldAlert size={18} className="text-success flex-none" />
              <p className="text-body-sm text-ink-primary">No compliance issues detected. Every active listing sits at or below its resale cap.</p>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Listing price vs. face value</span>
            {data.priceDistribution.length === 0 ? (
              <p className="text-body-sm text-ink-tertiary">No resale listings yet.</p>
            ) : (
              <Card padding="p-0">
                {data.priceDistribution.map((row, i) => {
                  const pct = row.face_value ? Math.round((row.price / row.face_value) * 100) : 0;
                  return (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex justify-between text-caption text-ink-tertiary">
                          <span>Face <MoneyText value={row.face_value} size="body" /></span>
                          <span className="tabular-nums">{pct}% of face value</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
                          <div className={`h-full ${pct > 100 ? "bg-danger" : "bg-brand-primary"}`} style={{ width: `${Math.min(pct, 150) / 1.5}%` }} />
                        </div>
                      </div>
                      <MoneyText value={row.price} className="font-semibold w-28 text-right flex-none" />
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
