import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, ArrowLeft } from "lucide-react";
import { ThemeToggle, Avatar, DropdownMenu, Drawer } from "../components/ui";
import { useAuth, useSurfaceAccess } from "../context/AuthContext";
import { cn } from "../lib/cn";
import BrandMark from "../components/BrandMark";
import AnnouncementBanner from "../components/AnnouncementBanner";

/**
 * Spec §2.1: fixed 264px sidebar, collapses to a 64px icon rail below 1280px
 * (xl), becomes an off-canvas drawer below 900px (custom `sidebar` breakpoint
 * in tailwind.config.js). One component, reused by Seller/Organiser/Admin —
 * each supplies its own nav groups, footer card and role label.
 *
 * navGroups: [{ label, badge?, items: [{ to, label, icon, end? }] }]
 */
function NavLinks({ navGroups, collapsed, onNavigate }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">{group.label}</span>
              {group.badge && (
                <span className="rounded-full bg-brand-primary/15 text-brand-primary-on-tint text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wide">
                  {group.badge}
                </span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-3 h-10 rounded-md text-body-sm font-medium transition-colors duration-150",
                    collapsed ? "justify-center px-0" : "px-2.5",
                    isActive ? "text-brand-primary-on-tint bg-brand-primary/10" : "text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-brand-primary shadow-[0_0_10px_var(--brand-primary)]" />}
                    <item.icon size={18} className="flex-none" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// The logo always goes home — same as every other surface.
function Brand({ collapsed, onNavigate }) {
  return (
    <div className={cn("flex items-center h-16 flex-none", collapsed ? "justify-center px-0" : "px-4")}>
      <Link to="/" onClick={onNavigate} title="Home" className="rounded-md">
        {collapsed ? <BrandMark /> : <BrandMark withWordmark />}
        {collapsed && <span className="sr-only">ChainTix</span>}
      </Link>
    </div>
  );
}

// Every surface this person can reach, minus the one they're on — so moving
// between Seller, Organiser and Admin never means going via the home page.
function useSwitchItems(surface) {
  const navigate = useNavigate();
  const access = useSurfaceAccess();
  const items = [{ label: "Events (home)", onClick: () => navigate("/") }, { label: "My tickets", onClick: () => navigate("/tickets") }];
  if (surface !== "seller") items.push({ label: "Seller portal", onClick: () => navigate("/seller") });
  if (surface !== "organiser" && access.organiser) items.push({ label: "Organiser Console", onClick: () => navigate("/organiser") });
  if (surface !== "admin" && access.admin) items.push({ label: "Platform admin", onClick: () => navigate("/admin") });
  return items;
}

/** surface: "seller" | "organiser" | "admin" — which one this shell is. */
export default function SidebarShell({ navGroups, footerCard, roleLabel, profilePath = "/", surface }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const switchItems = useSwitchItems(surface);

  return (
    <div className="min-h-screen flex app-backdrop">
      {/* Persistent sidebar >= 900px — icon rail 900-1279px, full 264px at xl+ */}
      <aside className="hidden sidebar:flex sidebar:w-16 xl:w-64 flex-none flex-col border-r border-line-subtle bg-surface sticky top-0 h-screen">
        <div className="xl:hidden">
          <Brand collapsed />
        </div>
        <div className="hidden xl:block">
          <Brand />
        </div>
        <div className="hidden sidebar:block xl:hidden flex-1 min-h-0">
          <NavLinks navGroups={navGroups} collapsed />
        </div>
        <div className="hidden xl:block flex-1 min-h-0">
          <NavLinks navGroups={navGroups} collapsed={false} />
        </div>
        {footerCard && <div className={cn("p-3 flex-none", "hidden xl:block")}>{footerCard}</div>}
      </aside>

      {/* Off-canvas drawer < 900px */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" title="Menu" width="280px">
        <div className="-m-5 flex flex-col h-full">
          <Link
            to="/"
            onClick={() => setDrawerOpen(false)}
            className="flex items-center gap-2 mx-3 mt-2 mb-1 px-2.5 h-10 rounded-md text-body-sm font-medium text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
          >
            <ArrowLeft size={16} /> Back to ChainTix
          </Link>
          <NavLinks navGroups={navGroups} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          {footerCard && <div className="p-3">{footerCard}</div>}
        </div>
      </Drawer>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 h-16 flex-none border-b border-line-subtle glass flex items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setDrawerOpen(true)} className="sidebar:hidden text-ink-secondary hover:text-ink-primary" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <Link to="/" title="Home" className="sidebar:hidden rounded-md"><BrandMark withWordmark /></Link>

          <span className="hidden sidebar:inline text-body-sm text-ink-tertiary">{roleLabel}</span>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle className="hidden sm:inline-flex" />
            <DropdownMenu
              trigger={
                <button className="flex items-center gap-2" aria-label="Account menu">
                  <Avatar name={user?.phoneNumber} size="sm" />
                </button>
              }
              items={[
                ...switchItems,
                { label: "My profile", onClick: () => navigate("/profile") },
                { label: "Settings", onClick: () => navigate(profilePath) },
                { label: "Log out", danger: true, onClick: () => { logout(); navigate("/"); } },
              ]}
            />
          </div>
        </header>

        <AnnouncementBanner />

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
