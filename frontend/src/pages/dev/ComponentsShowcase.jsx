import { useEffect, useState } from "react";
import { Ticket, Wallet, TrendingUp, Trash2, Pencil, Eye } from "lucide-react";
import {
  Button, Input, Select, Textarea, DatePicker, DateRangePicker, FileDropzone,
  Toggle, Checkbox, RadioGroup, Badge, Chip, Avatar, Card, StatCard, Table,
  Pagination, Tabs, Modal, Drawer, useToast, Tooltip, Popover, DropdownMenu,
  Breadcrumb, ProgressBar, Skeleton, SkeletonCard, EmptyState, ErrorState,
  SearchField, CopyButton, MoneyText, CountdownRing, QRDisplay, ChainBadge,
  TimelineStepper, FilterBar, ThemeToggle,
} from "../../components/ui";

const DEMO_ROWS = [
  { id: "TKT-4821", event: "Nairobi Music Festival", tier: "VIP", amount: 5500, status: "active" },
  { id: "TKT-4822", event: "Web3 Africa Summit", tier: "General", amount: 3000, status: "used" },
  { id: "TKT-4823", event: "Laugh Republic Live", tier: "Regular", amount: 800, status: "cancelled" },
];

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-4 py-10 border-t border-line-subtle first:border-t-0 first:pt-0">
      <h2 className="text-h1 text-ink-primary">{title}</h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Swatch({ label, varName }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-14 w-full rounded-sm border border-line-subtle" style={{ background: `var(${varName})` }} />
      <span className="text-caption text-ink-tertiary">{label}</span>
    </div>
  );
}

export default function ComponentsShowcase() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [select, setSelect] = useState("regular");
  const [toggleOn, setToggleOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("mpesa");
  const [tab, setTab] = useState("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });
  const [selectedRows, setSelectedRows] = useState([]);
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(2);
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s <= 1 ? 30 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-full bg-surface-base">
      <div className="sticky top-0 z-10 border-b border-line-subtle bg-surface/90 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-label uppercase tracking-[0.06em] text-brand-primary-on-tint font-semibold">spec.md §2.4 / §9.2</span>
          <h1 className="text-h1 text-ink-primary">Component Library</h1>
        </div>
        <ThemeToggle />
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-24">
        <Section title="Color tokens">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Swatch label="bg-base" varName="--bg-base" />
            <Swatch label="bg-surface" varName="--bg-surface" />
            <Swatch label="bg-elevated" varName="--bg-elevated" />
            <Swatch label="bg-inset" varName="--bg-inset" />
            <Swatch label="brand-primary" varName="--brand-primary" />
            <Swatch label="brand-accent" varName="--brand-accent" />
            <Swatch label="success" varName="--success" />
            <Swatch label="warning" varName="--warning" />
            <Swatch label="danger" varName="--danger" />
            <Swatch label="info" varName="--info" />
            <Swatch label="chain-verified" varName="--chain-verified" />
            <Swatch label="chain-pending" varName="--chain-pending" />
          </div>
        </Section>

        <Section title="Type scale">
          <div className="flex flex-col gap-2">
            <span className="text-display font-bold text-ink-primary">Display 34/1.15/700</span>
            <span className="text-h1 font-bold text-ink-primary">Heading 1 — 26/1.2/700</span>
            <span className="text-h2 font-semibold text-ink-primary">Heading 2 — 20/1.3/600</span>
            <span className="text-h3 font-semibold text-ink-primary">Heading 3 — 16/1.4/600</span>
            <span className="text-body text-ink-primary">Body — 14/1.55/400. The quick brown fox jumps over the lazy dog.</span>
            <span className="text-body-sm text-ink-secondary">Body small — 13/1.5/400</span>
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Label — 11/1.3/500 uppercase</span>
            <span className="text-metric font-bold tabular-nums text-ink-primary">1,240,500 — metric tabular</span>
            <span className="text-caption text-ink-tertiary">Caption — 12/1.4/400</span>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary lime</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button variant="secondary" iconOnly aria-label="Delete"><Trash2 size={16} /></Button>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid sm:grid-cols-2 gap-5">
            <Input label="Phone number" placeholder="07XX XXX XXX" hint="We'll send the STK push here" />
            <Input label="With error" defaultValue="not-a-number" error="Enter a valid Kenyan phone number" />
            <Select label="Ticket tier" value={select} onChange={(e) => setSelect(e.target.value)}>
              <option value="regular">Regular — KES 1,500</option>
              <option value="vip">VIP — KES 5,500</option>
            </Select>
            <Textarea label="Description" placeholder="What's this event about?" />
            <DatePicker label="Event date" withTime />
            <DateRangePicker label="Date range" value={range} onChange={setRange} />
          </div>
          <FileDropzone label="Event image" onFile={() => {}} />
          <div className="grid sm:grid-cols-3 gap-6">
            <Toggle checked={toggleOn} onChange={setToggleOn} label="Enable resale" hint="Allow buyers to resell tickets" />
            <Checkbox checked={checked} onChange={setChecked} label="I agree to the terms" />
            <RadioGroup
              label="Payment method"
              value={radio}
              onChange={setRadio}
              options={[
                { value: "mpesa", label: "M-Pesa", hint: "STK push to your phone" },
                { value: "card", label: "Card", hint: "Visa / Mastercard", disabled: true },
              ]}
            />
          </div>
          <SearchField value={search} onChange={setSearch} placeholder="Search events or venues" className="max-w-sm" />
        </Section>

        <Section title="Badges, chips, avatars">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">Confirmed</Badge>
            <Badge tone="warning">Pending T+2</Badge>
            <Badge tone="danger">Denied</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="verified">Verified</Badge>
            <Badge tone="pending">Minting</Badge>
            <Badge tone="neutral">Neutral</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip selected onClick={() => {}}>Music</Chip>
            <Chip onClick={() => {}}>Conference</Chip>
            <Chip onRemove={() => {}}>Removable tag</Chip>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name="Leriari Tobiko" size="sm" />
            <Avatar name="Zuri Events" size="md" />
            <Avatar name="Chain Collective" size="lg" />
          </div>
        </Section>

        <Section title="Cards & stats">
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard label="Total revenue" value={<MoneyText value={482500} size="metric" />} icon={<Wallet size={18} />} delta={{ value: "12.4% vs last week", direction: "up" }} />
            <StatCard label="Tickets sold" value="1,240" icon={<Ticket size={18} />} hint="of 2,000 capacity" emphasised />
            <StatCard label="ChainTix fee (5%)" value={<MoneyText value={24125} variant="negative" size="metric" />} icon={<TrendingUp size={18} />} />
          </div>
        </Section>

        <Section title="Money, chain badge, countdown, QR">
          <div className="flex flex-wrap items-center gap-6">
            <MoneyText value={3500} variant="neutral" size="h3" />
            <MoneyText value={3400} variant="positive" size="h3" />
            <MoneyText value={400} variant="negative" size="h3" />
            <MoneyText value={0} variant="positive" size="h3" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ChainBadge status="pending" />
            <ChainBadge status="verified" txUrl="https://basescan.org" />
            <ChainBadge status="failed" />
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <CountdownRing secondsLeft={seconds} totalSeconds={30}>
              <span className="text-h3 font-bold tabular-nums text-ink-primary">{seconds}</span>
            </CountdownRing>
            <QRDisplay value="TIKETI:demo-ticket:482910" size={140} />
          </div>
        </Section>

        <Section title="Tabs, stepper, breadcrumb">
          <Tabs
            items={[{ value: "active", label: "Active", count: 3 }, { value: "used", label: "Used", count: 12 }, { value: "resale", label: "Listed for resale" }]}
            value={tab}
            onChange={setTab}
            className="max-w-md"
          />
          <TimelineStepper steps={[{ label: "Details" }, { label: "Payment" }, { label: "Confirmation" }]} activeIndex={1} />
          <Breadcrumb items={[{ label: "Dashboard", to: "#" }, { label: "Earnings" }]} />
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open drawer</Button>
            <Tooltip content="Minimum withdrawal is KES 101">
              <Button variant="ghost" size="sm">Hover for tooltip</Button>
            </Tooltip>
            <Popover trigger={<Button variant="secondary" size="sm">Open popover</Button>}>
              <p className="text-body-sm text-ink-primary w-56">Popovers hold interactive content — filters, mini-forms.</p>
            </Popover>
            <DropdownMenu
              trigger={<Button variant="secondary" size="sm">Row actions ▾</Button>}
              items={[
                { label: "View", icon: <Eye size={14} /> },
                { label: "Edit", icon: <Pencil size={14} /> },
                { label: "Delete", icon: <Trash2 size={14} />, danger: true },
              ]}
            />
            <Button
              variant="secondary"
              onClick={() =>
                toast.push("Ticket listed for resale.", { tone: "success" })
              }
            >
              Fire a toast
            </Button>
          </div>
          <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Confirm transfer" footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>Confirm</Button>
            </>
          }>
            This ticket will be permanently transferred. Your current credential is invalidated instantly.
          </Modal>
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Filters" side="right" width="320px">
            <div className="flex flex-col gap-4">
              <Select label="Status"><option>All</option><option>Active</option></Select>
              <DateRangePicker label="Date range" value={range} onChange={setRange} />
            </div>
          </Drawer>
        </Section>

        <Section title="Progress, skeleton, empty, error">
          <ProgressBar value={3412} max={4380} label="3,412 of 4,380 cached" showPercent />
          <div className="grid sm:grid-cols-3 gap-4">
            <SkeletonCard />
            <Skeleton className="h-24 w-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card padding="p-0">
              <EmptyState title="No transactions yet" description="Start by selling a ticket!" actionLabel="Sell a Ticket" onAction={() => {}} />
            </Card>
            <Card padding="p-0">
              <ErrorState title="Couldn't load your wallet" description="Check your connection and try again." onRetry={() => {}} onWorkOffline={() => {}} />
            </Card>
          </div>
        </Section>

        <Section title="Table, filter bar, pagination">
          <FilterBar active onClear={() => {}}>
            <SearchField value={search} onChange={setSearch} placeholder="Search tickets" className="w-56" />
            <Select className="w-40"><option>All events</option></Select>
            <DateRangePicker value={range} onChange={setRange} />
          </FilterBar>
          <Table
            columns={[
              { key: "id", header: "Ticket ID", sortable: true, render: (r) => <span className="font-mono text-caption">{r.id}</span> },
              { key: "event", header: "Event", sortable: true },
              { key: "tier", header: "Tier" },
              { key: "amount", header: "Amount", render: (r) => <MoneyText value={r.amount} /> },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <Badge tone={r.status === "active" ? "success" : r.status === "used" ? "neutral" : "danger"}>{r.status}</Badge>
                ),
              },
            ]}
            data={DEMO_ROWS}
            selectable
            selectedIds={selectedRows}
            onSelectedChange={setSelectedRows}
            sort={sort}
            onSortChange={setSort}
            rowActions={() => [
              { label: "View", icon: <Eye size={14} /> },
              { label: "Void", icon: <Trash2 size={14} />, danger: true },
            ]}
          />
          <Pagination page={page} totalPages={8} onChange={setPage} />
        </Section>

        <Section title="Copy button">
          <div className="flex items-center gap-2 text-body-sm text-ink-secondary font-mono">
            0x8f3a...c21e <CopyButton value="0x8f3ac21e" />
          </div>
        </Section>
      </div>
    </div>
  );
}
