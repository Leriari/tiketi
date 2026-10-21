import {
  LayoutDashboard, TrendingUp, FileBarChart, Megaphone, Ticket, Search, CalendarPlus, Users2,
  Link2, ScanLine, QrCode, ListChecks, FileCheck2, BarChart3, UserCheck, FolderOutput,
  Building2, Banknote, UsersRound,
} from "lucide-react";
import { ThemeProvider } from "../theme/ThemeProvider";
import { usingMockBackend } from "../api";
import { useAuth } from "../context/AuthContext";
import SidebarShell from "./SidebarShell";

const NAV_GROUPS = [
  {
    label: "Event Ticketing Core",
    badge: "CORE",
    items: [
      { to: "/organiser", label: "Control Center", icon: LayoutDashboard, end: true },
      { to: "/organiser/earnings", label: "Earnings", icon: TrendingUp },
      { to: "/organiser/reports", label: "Reports", icon: FileBarChart },
      { to: "/organiser/marketing", label: "Marketing Analytics", icon: Megaphone },
      { to: "/organiser/tickets", label: "Ticket Central", icon: Ticket },
      { to: "/organiser/audit", label: "Ticket Audit Lookup", icon: Search },
      { to: "/organiser/events", label: "Events", icon: CalendarPlus },
      { to: "/organiser/crowd-control", label: "Crowd Control", icon: Users2 },
    ],
  },
  {
    label: "Membership & VIP",
    badge: "VIP",
    items: [
      { to: "/organiser/scanners", label: "QR Scanner Hub", icon: QrCode },
      { to: "/organiser/scan", label: "Live QR Scanner", icon: ScanLine },
      { to: "/organiser/guests", label: "Guest Lists", icon: ListChecks },
    ],
  },
  {
    label: "Blockchain",
    items: [
      { to: "/organiser/contract", label: "Contract Status", icon: Link2 },
      { to: "/organiser/royalties", label: "Royalty Ledger", icon: FileCheck2 },
      { to: "/organiser/compliance", label: "Resale Compliance", icon: BarChart3 },
    ],
  },
  {
    label: "Analytics & Reports",
    items: [
      { to: "/organiser/attendance", label: "Attendance", icon: UserCheck },
      { to: "/organiser/revenue", label: "Revenue Breakdown", icon: TrendingUp },
      { to: "/organiser/exports", label: "Export Centre", icon: FolderOutput },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/organiser/profile", label: "Organisation Profile", icon: Building2 },
      { to: "/organiser/payouts", label: "Payout Details", icon: Banknote },
      { to: "/organiser/team", label: "Team & Roles", icon: UsersRound },
    ],
  },
];

function OrganisationLabel() {
  const { roles, activeOrganisation, switchOrganisation } = useAuth();
  if (usingMockBackend || !activeOrganisation) return "Organiser Console";
  const role = activeOrganisation.role === "owner" ? "Owner" : "Staff";
  if (roles.organisations.length < 2) {
    return `Organiser Console · ${activeOrganisation.businessName} (${role})`;
  }
  return (
    <span className="inline-flex items-center gap-2">
      Organiser Console ·
      <select
        aria-label="Organisation"
        value={activeOrganisation.id}
        onChange={(e) => switchOrganisation(e.target.value)}
        className="bg-transparent text-ink-primary font-semibold rounded-sm border border-line px-1.5 py-0.5"
      >
        {roles.organisations.map((o) => (
          <option key={o.id} value={o.id}>{o.businessName} ({o.role === "owner" ? "Owner" : "Staff"})</option>
        ))}
      </select>
    </span>
  );
}

export default function OrganiserShell() {
  const { activeOrganisation } = useAuth();
  // Keyed by organisation so switching remounts every page and refetches.
  return (
    <ThemeProvider surfaceDefault="light">
      <SidebarShell
        key={activeOrganisation?.id || "none"}
        navGroups={NAV_GROUPS}
        roleLabel={<OrganisationLabel />}
        profilePath="/organiser/profile"
        surface="organiser"
      />
    </ThemeProvider>
  );
}
