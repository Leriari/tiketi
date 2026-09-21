import { Link, useNavigate } from "react-router-dom";
import { Tag, ListChecks } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import { StatCard, Card, Button, MoneyText, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { formatPhone } from "../../format";
import EscrowBanner from "./components/EscrowBanner";

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SellerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, retry } = useApiData(() => api.getSellerDashboard());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <EscrowBanner />

      <div>
        <h1 className="text-h1 text-ink-primary">Welcome back{user ? `, ${formatPhone(user.phoneNumber).slice(0, 4)}…` : ""} 👋</h1>
        <p className="text-body-sm text-ink-tertiary">Manage your ticket listings and wallet.</p>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Listings" value={data.stats.totalListings} />
            <StatCard label="Pending Review" value={data.stats.pendingReview} />
            <StatCard label="Live Listings" value={data.stats.liveListings} emphasised />
            <StatCard label="Sold Tickets" value={data.stats.soldTickets} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="flex flex-col gap-3">
              <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Wallet Balance</span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-caption text-ink-tertiary">Available</p>
                  <MoneyText value={data.wallet.available} size="h3" variant="positive" />
                </div>
                <div>
                  <p className="text-caption text-ink-tertiary">Pending</p>
                  <MoneyText value={data.wallet.pending} size="h3" variant="pending" />
                </div>
                <div>
                  <p className="text-caption text-ink-tertiary">On Hold</p>
                  <MoneyText value={data.wallet.onHold} size="h3" />
                </div>
              </div>
              <Link to="/seller/wallet" className="text-body-sm font-semibold text-brand-primary-on-tint w-fit">View Wallet →</Link>
            </Card>

            <Card className="flex flex-col gap-3">
              <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Quick Actions</span>
              <Button variant="primary" iconLeft={<Tag size={15} />} onClick={() => navigate("/seller/sell")}>Sell a Ticket</Button>
              <Button variant="ghost" iconLeft={<ListChecks size={15} />} onClick={() => navigate("/seller/listings")}>My Listings</Button>
            </Card>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Recent Transactions</span>
            {data.recentTransactions.length === 0 ? (
              <Card padding="p-0">
                <EmptyState
                  title="No transactions yet"
                  description="Start by selling a ticket!"
                  actionLabel="Sell a Ticket"
                  onAction={() => navigate("/seller/sell")}
                />
              </Card>
            ) : (
              <Card padding="p-0">
                {data.recentTransactions.map((t, i) => (
                  <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                    <div>
                      <p className="text-body-sm text-ink-primary font-medium">{t.description}</p>
                      <p className="text-caption text-ink-tertiary">{timeAgo(t.created_at)}</p>
                    </div>
                    <MoneyText value={t.amount} variant={t.amount < 0 ? "negative" : "positive"} />
                  </div>
                ))}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
