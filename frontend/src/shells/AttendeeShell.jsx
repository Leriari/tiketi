import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Compass, Ticket, User, Search } from "lucide-react";
import { ThemeProvider } from "../theme/ThemeProvider";
import { ThemeToggle } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import InstallPrompt from "../components/InstallPrompt";

const TABS = [
  { to: "/", label: "Discover", icon: Compass, end: true },
  { to: "/tickets", label: "My Tickets", icon: Ticket },
  { to: "/account", label: "Account", icon: User },
];

function NavItem({ to, label, icon: Icon, end, className, compact = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          compact
            ? "flex flex-col items-center gap-1 py-2 text-caption font-semibold flex-1"
            : "inline-flex items-center gap-2 px-3 py-2 rounded-sm text-body-sm font-semibold",
          isActive ? "text-brand-primary-on-tint" : "text-ink-secondary hover:text-ink-primary",
          className
        )
      }
    >
      <Icon size={compact ? 20 : 16} />
      {label}
    </NavLink>
  );
}

/** spec.md §3: mobile-first, bottom tab bar on mobile, top nav on desktop >=1024px. */
export default function AttendeeShell() {
  const navigate = useNavigate();
  const { isAuthed, user } = useAuth();

  return (
    <ThemeProvider surfaceDefault="dark">
      <div className="min-h-screen bg-surface-base flex flex-col">
        <header className="sticky top-0 z-20 border-b border-line-subtle bg-surface-base/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
            <button onClick={() => navigate("/")} className="flex items-center gap-2 font-bold text-h3 text-ink-primary">
              <span className="h-7 w-7 rounded-md bg-brand-accent flex items-center justify-center text-brand-accent-ink font-black">C</span>
              ChainTix
            </button>

            <nav className="hidden lg:flex items-center gap-1">
              {TABS.map((t) => (
                <NavItem key={t.to} {...t} />
              ))}
            </nav>

            <button
              onClick={() => navigate("/events")}
              className="hidden md:inline-flex items-center gap-2 rounded-sm bg-surface-elevated border border-line px-3 py-2 text-body-sm text-ink-tertiary hover:text-ink-primary hover:border-line-strong"
            >
              <Search size={15} /> Search events, artists, venues
            </button>

            <div className="flex items-center gap-3">
              <ThemeToggle className="hidden sm:inline-flex" />
              {isAuthed && <span className="hidden sm:inline text-caption text-ink-tertiary">{user.phoneNumber}</span>}
            </div>
          </div>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-surface border-t border-line-subtle">
          <div className="mx-auto max-w-6xl flex">
            {TABS.map((t) => (
              <NavItem key={t.to} {...t} compact />
            ))}
          </div>
        </nav>

        <InstallPrompt />
      </div>
    </ThemeProvider>
  );
}
