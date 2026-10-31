import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck, Ticket, Repeat, Building2, Crown, Pencil, Check, X, LogOut, MonitorSmartphone,
  CreditCard, Wallet, ScanLine, KeyRound, ChevronRight,
} from "lucide-react";
import { api, ApiError, usingMockBackend } from "../api";
import { useAuth } from "../context/AuthContext";
import { useApiData } from "../lib/useApiData";
import { useToast } from "../components/ui/Toast";
import { Avatar, Badge, Button, Card, MoneyText, Skeleton, ErrorState, EmptyState, Modal } from "../components/ui";
import { formatPhone } from "../format";
import { cn } from "../lib/cn";

// docs/design-principles.md — P1: identity and money lead; P2/P4: labels and
// numbers read as instrument readouts; P3: colour only where it signals.

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "security", label: "Security" },
  { value: "purchase", label: "Purchases" },
  { value: "resale", label: "Resale" },
  { value: "ticket", label: "Tickets" },
  { value: "payout", label: "Payouts" },
  { value: "organiser", label: "Organiser" },
];

const CATEGORY_ICON = {
  security: KeyRound, purchase: CreditCard, resale: Repeat, ticket: ScanLine, payout: Wallet, organiser: Building2,
};

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-KE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
function fmtAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Readout({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">{label}</span>
      <span className="text-h2 font-semibold tabular-nums text-ink-primary truncate">{value}</span>
      {hint && <span className="text-caption text-ink-tertiary truncate">{hint}</span>}
    </div>
  );
}

function RolePanel({ icon: Icon, title, role, to, toLabel, children }) {
  return (
    <Card padding="p-0" className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <span className="flex items-center gap-2 min-w-0">
          <Icon size={16} className="text-brand-primary-on-tint flex-none" />
          <span className="text-body font-semibold text-ink-primary truncate">{title}</span>
        </span>
        {role && <Badge tone="brand">{role}</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-4 px-5 py-4">{children}</div>
      {to && (
        <Link to={to} className="flex items-center justify-between px-5 py-2.5 border-t border-line-subtle text-body-sm font-medium text-ink-secondary hover:text-ink-primary hover:bg-surface-elevated transition-colors">
          {toLabel} <ChevronRight size={15} />
        </Link>
      )}
    </Card>
  );
}

/** The account email (receipts go here): shown with a Change link, edited inline. */
function EmailEditor({ email, verified, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your email.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {email ? <span>{email}</span> : <span className="text-ink-tertiary">No email yet</span>}
        {email && verified && <Badge tone="verified">Verified</Badge>}
        <button type="button" onClick={() => { setValue(email || ""); setEditing(true); }} className="text-caption underline text-ink-tertiary hover:text-ink-primary">
          {email ? "Change" : "Add email"}
        </button>
      </span>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-1 w-full sm:w-auto">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Your email address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-64 max-w-full rounded-md bg-surface-inset border border-brand-primary px-3 text-body-sm text-ink-primary focus:outline-none"
        />
        <Button type="submit" size="sm" loading={busy} className="w-auto px-3">Save</Button>
        <button type="button" onClick={() => setEditing(false)} className="text-caption text-ink-tertiary underline">Cancel</button>
      </div>
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      <p className="text-caption text-ink-tertiary">Your ticket receipts are sent here.</p>
    </form>
  );
}

function NameEditor({ name, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setValue(name || ""); setEditing(true); }} className="group flex items-center gap-2 text-left">
        <h1 className={cn("text-display font-semibold tracking-[-0.03em]", name ? "text-ink-primary" : "text-ink-tertiary")}>
          {name || "Add your name"}
        </h1>
        <Pencil size={16} className="text-ink-tertiary opacity-60 group-hover:opacity-100" aria-label="Edit name" />
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          aria-label="Your name"
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          className="h-11 w-72 max-w-full rounded-md bg-surface-inset border border-brand-primary shadow-glow-focus px-3 text-h2 font-semibold text-ink-primary focus:outline-none"
        />
        <Button type="submit" iconOnly size="md" loading={busy} aria-label="Save name"><Check size={16} /></Button>
        <Button type="button" iconOnly size="md" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel"><X size={16} /></Button>
      </div>
      {error && <span role="alert" className="text-caption text-danger">{error}</span>}
    </form>
  );
}

function ActivityLog() {
  const [category, setCategory] = useState("");
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    api.getActivity({ category: category || undefined })
      .then((res) => { if (!cancelled) { setItems(res.items); setHasMore(res.has_more); } })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load your activity."));
    return () => { cancelled = true; };
  }, [category]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.getActivity({ category: category || undefined, before: items[items.length - 1].at });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.has_more);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const days = useMemo(() => {
    const groups = [];
    for (const item of items || []) {
      const day = fmtDay(item.at);
      if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [items]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">System log</span>
          <h2 className="text-h2 font-semibold text-ink-primary tracking-[-0.02em]">Account activity</h2>
        </div>
        <div role="tablist" aria-label="Filter activity" className="flex flex-wrap gap-1 rounded-md bg-surface-inset border border-line-subtle p-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value || "all"}
              role="tab"
              aria-selected={category === c.value}
              onClick={() => setCategory(c.value)}
              className={cn(
                "px-2.5 py-1 rounded-sm text-caption font-medium transition-colors",
                category === c.value ? "bg-surface-elevated text-ink-primary shadow-highlight" : "text-ink-tertiary hover:text-ink-secondary"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState description={error} onRetry={() => setCategory((c) => c)} />}
      {!error && items === null && <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {!error && items?.length === 0 && (
        <Card padding="p-0"><EmptyState title="Nothing here yet" description="Purchases, sign-ins, resales and payouts will show up here as they happen." /></Card>
      )}

      {days.map((group) => (
        <div key={group.day} className="flex flex-col">
          <div className="sticky top-16 z-[1] py-1.5 glass">
            <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">{group.day}</span>
          </div>
          <ol className="relative ml-[15px] border-l border-line-subtle">
            {group.items.map((item) => {
              const Icon = CATEGORY_ICON[item.category] || ShieldCheck;
              const body = (
                <div className="flex items-start gap-3 py-2.5 pl-6 pr-2 rounded-md hover:bg-surface-elevated/60 transition-colors">
                  <span className={cn(
                    "absolute -left-[13px] mt-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border bg-surface",
                    item.category === "security" ? "border-brand-primary/50 text-brand-primary-on-tint" : "border-line text-ink-secondary"
                  )}>
                    <Icon size={13} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-ink-primary">{item.title}</p>
                    {item.detail && <p className="text-caption text-ink-tertiary truncate">{item.detail}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-none">
                    {item.amount_kes != null && (
                      <MoneyText value={Math.abs(item.amount_kes)} variant={item.amount_kes < 0 ? "negative" : "positive"} size="body" className="text-body-sm" />
                    )}
                    <span className="text-caption tabular-nums text-ink-tertiary">{fmtTime(item.at)}</span>
                  </div>
                </div>
              );
              return (
                <li key={item.id} className="relative">
                  {item.link ? <Link to={item.link} className="block">{body}</Link> : body}
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      {hasMore && (
        <Button variant="secondary" onClick={loadMore} loading={loadingMore} className="self-center w-auto px-6">Load earlier activity</Button>
      )}
    </section>
  );
}

/**
 * One profile for every role a person holds — attendee, seller, organiser
 * member, platform admin — plus their security state and account activity.
 */
export default function Profile() {
  const navigate = useNavigate();
  const toast = useToast();
  const { switchOrganisation, signOutEverywhere, refreshRoles, logout } = useAuth();
  const { data: profile, error, retry, setData } = useApiData(() => api.getProfile());
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function saveName(name) {
    const next = await api.updateProfile({ displayName: name });
    setData(next);
    refreshRoles();
    toast.push("Name saved.", { tone: "success" });
  }

  async function saveEmail(email) {
    const next = await api.updateProfile({ email });
    setData(next);
    refreshRoles();
    toast.push("Email saved.", { tone: "success" });
  }

  async function doSignOutEverywhere() {
    setSigningOut(true);
    try {
      await signOutEverywhere();
      setConfirmSignOut(false);
      toast.push("Signed out of every other device.", { tone: "success" });
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't sign out other devices.", { tone: "danger" });
    } finally {
      setSigningOut(false);
    }
  }

  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><ErrorState description={error} onRetry={retry} /></div>;
  if (!profile) {
    return (
      <div className="mx-auto max-w-5xl px-4 lg:px-6 py-8 flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <div className="grid md:grid-cols-2 gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      </div>
    );
  }

  const { user, security, attendee, seller, organisations } = profile;
  const last = security.last_sign_in;

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-8 flex flex-col gap-8">
      {/* Identity — P1: who you are, then what you hold. */}
      <Card padding="p-0" className="overflow-hidden">
        <div className="relative px-6 pt-6 pb-5 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-primary/60 to-transparent" aria-hidden="true" />
          <Avatar name={user.display_name || user.phone_number} size="lg" className="h-16 w-16 text-h2 ring-1 ring-line" />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <NameEditor name={user.display_name} onSave={saveName} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-secondary">
              <span className="tabular-nums">{formatPhone(user.phone_number)}</span>
              {user.phone_verified === false && <Badge tone="warning">Unverified</Badge>}
              <EmailEditor email={user.email} verified={user.email_verified} onSave={saveEmail} />
              {user.member_since && <span className="text-ink-tertiary">Member since {new Date(user.member_since).toLocaleDateString("en-KE", { month: "short", year: "numeric" })}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge tone="neutral">Attendee</Badge>
              {(seller.active_listings > 0 || seller.tickets_sold > 0) && <Badge tone="neutral">Seller</Badge>}
              {organisations.map((o) => <Badge key={o.id} tone="brand">{o.role === "owner" ? "Owner" : "Staff"} · {o.business_name}</Badge>)}
              {profile.platform_admin && <Badge tone="accent">Platform admin</Badge>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line-subtle border-t border-line-subtle">
          {[
            ["Tickets held", attendee.tickets_held],
            ["Upcoming events", attendee.upcoming_events],
            ["Events attended", attendee.events_attended],
            ["Tickets resold", seller.tickets_sold],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-6 py-4"><Readout label={label} value={value} /></div>
          ))}
        </div>
      </Card>

      {/* Roles — one panel per hat this person wears. */}
      <section className="flex flex-col gap-3">
        <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">Roles</span>
        <div className="grid md:grid-cols-2 gap-4">
          <RolePanel icon={Ticket} title="Attendee" to="/tickets" toLabel="My tickets">
            <Readout label="Held" value={attendee.tickets_held} />
            <Readout label="Upcoming" value={attendee.upcoming_events} />
            <Readout label="Attended" value={attendee.events_attended} />
          </RolePanel>
          <RolePanel icon={Repeat} title="Seller" to="/seller" toLabel="Seller portal">
            <Readout label="Listed" value={seller.active_listings} />
            <Readout label="Available" value={<MoneyText value={seller.available_kes} size="h3" />} />
            <Readout label="Pending" value={<MoneyText value={seller.pending_kes} size="h3" variant="pending" />} />
          </RolePanel>
          {organisations.map((o) => (
            <RolePanel key={o.id} icon={Building2} title={o.business_name} role={o.role === "owner" ? "Owner" : "Staff"}>
              <Readout label="Events" value={o.events} />
              <Readout label="Status" value={<span className="text-body font-semibold capitalize">{o.verification_status}</span>} />
              <div className="flex items-end">
                <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => { switchOrganisation(o.id); navigate("/organiser"); }}>Open console</Button>
              </div>
            </RolePanel>
          ))}
          {profile.platform_admin && (
            <RolePanel icon={Crown} title="Platform admin" to="/admin" toLabel="Admin console">
              <Readout label="Access" value={<span className="text-body font-semibold">Full</span>} />
            </RolePanel>
          )}
          {!usingMockBackend && organisations.length === 0 && (
            <Card className="flex flex-col justify-center gap-2 border-dashed">
              <span className="text-body-sm font-semibold text-ink-primary">Run events?</span>
              <span className="text-caption text-ink-tertiary">
                Register your organisation to sell tickets on ChainTix. Joining someone else's team instead? Ask its owner to add you.
              </span>
              <Button size="sm" variant="secondary" className="w-auto self-start px-4" onClick={() => navigate("/organiser/register")}>
                Become an organiser
              </Button>
            </Card>
          )}
        </div>
      </section>

      {/* Security — P3: the one place violet means "this is about access". */}
      <section className="flex flex-col gap-3">
        <span className="text-label uppercase tracking-[0.08em] text-ink-tertiary">Security</span>
        <Card className="grid md:grid-cols-3 gap-5 items-center">
          <Readout label="Sign-in methods" value={<span className="text-body font-semibold">{security.sign_in_methods.join(" + ")}</span>} hint={user.google_linked ? "Google is linked to your phone" : "Add Google from the login screen"} />
          <div className="flex items-start gap-3">
            <MonitorSmartphone size={18} className="text-ink-tertiary mt-1 flex-none" />
            <Readout
              label="Last sign-in"
              value={<span className="text-body font-semibold">{last ? fmtAgo(last.at) : "—"}</span>}
              hint={last ? [last.method, last.device].filter(Boolean).join(" · ") : undefined}
            />
          </div>
          <div className="flex md:justify-end gap-2 flex-wrap">
            <Button variant="secondary" size="sm" iconLeft={<ShieldCheck size={14} />} onClick={() => setConfirmSignOut(true)}>Sign out everywhere</Button>
            <Button variant="ghost" size="sm" iconLeft={<LogOut size={14} />} onClick={() => { logout(); navigate("/"); }}>Log out</Button>
          </div>
        </Card>
      </section>

      <ActivityLog />

      <Modal open={confirmSignOut} onClose={() => setConfirmSignOut(false)} title="Sign out everywhere?">
        <p className="text-body-sm text-ink-secondary">
          Every other phone, tablet or browser signed in to this account will be signed out immediately. You'll stay signed in here.
        </p>
        <div className="flex gap-2 pt-4">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmSignOut(false)}>Cancel</Button>
          <Button className="flex-1" loading={signingOut} onClick={doSignOutEverywhere}>Sign out others</Button>
        </div>
      </Modal>
    </div>
  );
}
