import {
  LayoutDashboard, Building2, ClipboardCheck, Receipt, Percent, Clock,
  BarChart3, ShieldAlert, History, UsersRound, Megaphone, Bell, ToggleLeft,
} from "lucide-react";
import { ThemeProvider } from "../theme/ThemeProvider";
import SidebarShell from "./SidebarShell";

const NAV_GROUPS = [
  {
    label: "Oversight",
    items: [
      { to: "/admin", label: "Platform Dashboard", icon: LayoutDashboard, end: true },
      { to: "/admin/organisers", label: "Organiser Accounts", icon: Building2 },
      { to: "/admin/events", label: "Event Approvals", icon: ClipboardCheck },
    ],
  },
  {
    label: "Financial",
    items: [
      { to: "/admin/costs", label: "Platform Costs", icon: Receipt },
      { to: "/admin/fees", label: "Fee Configuration", icon: Percent },
      { to: "/admin/payouts", label: "Payout Queue", icon: Clock },
    ],
  },
  {
    label: "Integrity",
    items: [
      { to: "/admin/compliance", label: "Resale Compliance", icon: BarChart3 },
      { to: "/admin/fraud", label: "Fraud Signals", icon: ShieldAlert },
      { to: "/admin/audit", label: "Audit Log", icon: History },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/admin/admins", label: "Admin Users", icon: UsersRound },
      { to: "/admin/broadcasts", label: "Communication Center", icon: Megaphone },
      { to: "/admin/notifications", label: "Notifications", icon: Bell },
      { to: "/admin/flags", label: "Feature Flags", icon: ToggleLeft },
    ],
  },
];

export default function AdminShell() {
  return (
    <ThemeProvider surfaceDefault="light">
      <SidebarShell navGroups={NAV_GROUPS} roleLabel="Platform Admin" profilePath="/admin/admins" />
    </ThemeProvider>
  );
}
