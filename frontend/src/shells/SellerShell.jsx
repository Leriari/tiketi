import { LayoutDashboard, Tag, ListChecks, History, Wallet, Receipt, HelpCircle, MessageCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { ThemeProvider } from "../theme/ThemeProvider";
import SidebarShell from "./SidebarShell";

const NAV_GROUPS = [
  { label: "Main", items: [{ to: "/seller", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    label: "Listings",
    items: [
      { to: "/seller/sell", label: "Sell a Ticket", icon: Tag },
      { to: "/seller/listings", label: "My Listings", icon: ListChecks },
      { to: "/seller/sold", label: "Sold History", icon: History },
    ],
  },
  {
    label: "Financial",
    items: [
      { to: "/seller/wallet", label: "Wallet", icon: Wallet },
      { to: "/seller/payouts", label: "Payout History", icon: Receipt },
    ],
  },
  {
    label: "Support",
    items: [
      { to: "/seller/help", label: "Help & FAQs", icon: HelpCircle },
      { to: "/seller/contact", label: "Contact Support", icon: MessageCircle },
      { to: "/seller/disputes", label: "Dispute Centre", icon: ShieldAlert },
    ],
  },
];

function FooterCard() {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-elevated p-3 flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-body-sm font-semibold text-ink-primary">
        <ShieldCheck size={14} className="text-chain-verified" /> Secure Escrow
      </span>
      <p className="text-caption text-ink-tertiary">Your funds are protected until the event ends. T+2 payout system.</p>
    </div>
  );
}

export default function SellerShell() {
  return (
    <ThemeProvider surfaceDefault="dark">
      <SidebarShell navGroups={NAV_GROUPS} footerCard={<FooterCard />} roleLabel="P2P Marketplace" profilePath="/seller/profile" surface="seller" />
    </ThemeProvider>
  );
}
