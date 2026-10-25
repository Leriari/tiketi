import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Compass, Ticket, User, Search, LogIn, Repeat } from "lucide-react";
import { ThemeProvider } from "../theme/ThemeProvider";
import { ThemeToggle, Button, Avatar, DropdownMenu } from "../components/ui";
import { useAuth, useSurfaceAccess } from "../context/AuthContext";
import { formatPhone } from "../format";
import { cn } from "../lib/cn";
import InstallPrompt from "../components/InstallPrompt";
import BrandMark from "../components/BrandMark";
import AnnouncementBanner from "../components/AnnouncementBanner";

const TABS = [
  { to: "/", label: "Discover", icon: Compass, end: true },
  { to: "/resale", label: "Resale", icon: Repeat },
  { to: "/tickets", label: "My Tickets", icon: Ticket },
  { to: "/profile", label: "Profile", icon: User },
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
  const location = useLocation();
  const { isAuthed, user, roles, logout } = useAuth();
  const access = useSurfaceAccess();

  const loginHref = `/login?return=${encodeURIComponent(location.pathname + location.search)}`;
  const userMenuItems = [
    { label: "My tickets", onClick: () => navigate("/tickets") },
    { label: "My profile", onClick: () => navigate("/profile") },
    { label: "Sell tickets", onClick: () => navigate("/seller") },
    ...(access.organiser ? [{ label: "Organiser Console", onClick: () => navigate("/organiser") }] : []),
    ...(access.admin ? [{ label: "Platform admin", onClick: () => navigate("/admin") }] : []),
    { label: "Log out", danger: true, onClick: () => { logout(); navigate("/"); } },
  ];

  return (
    <ThemeProvider surfaceDefault="dark">
      <div className="min-h-screen app-backdrop flex flex-col">
        <header className="sticky top-0 z-20 border-b border-line-subtle glass">
          <div className="mx-auto max-w-6xl px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
            <button onClick={() => navigate("/")} title="Home">
              <BrandMark withWordmark />
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
              {isAuthed ? (
                <DropdownMenu
                  trigger={
                    <button className="flex items-center gap-2 text-ink-secondary hover:text-ink-primary">
                      {/* Real text, not aria-label: the name is visible from sm up and
                          screen-reader-only below, so the accessible name always
                          matches what sighted users see (WCAG 2.5.3). */}
                      <span className="sr-only sm:not-sr-only text-caption">{roles.displayName || formatPhone(user.phoneNumber)}</span>
                      <span className="sr-only">, account menu</span>
                      <Avatar name={roles.displayName || user.phoneNumber} size="sm" />
                    </button>
                  }
                  items={userMenuItems}
                />
              ) : (
                <Button size="sm" iconLeft={<LogIn size={14} />} onClick={() => navigate(loginHref)}>
                  Log in
                </Button>
              )}
            </div>
          </div>
        </header>

        <AnnouncementBanner />

        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 glass border-t border-line-subtle">
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
