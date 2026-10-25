import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import ScrollToTop from "./ScrollToTop";
import AuthErrorToast from "./AuthErrorToast";
import { RequireAuth, RequireOrgMembership, RequirePlatformAdmin, RequireDeviceToken } from "./routeGuards";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./components/ui/Toast";
import { ThemeProvider } from "./theme/ThemeProvider";
import Login from "./pages/Login";
import AttendeeShell from "./shells/AttendeeShell";
import Landing from "./pages/attendee/Landing";
import Browse from "./pages/attendee/Browse";
import EventDetail from "./pages/attendee/EventDetail";
import Checkout from "./pages/attendee/Checkout";
import Confirmation from "./pages/attendee/Confirmation";
import MyTickets from "./pages/attendee/MyTickets";
import TicketCredential from "./pages/attendee/TicketCredential";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import EventsList from "./pages/organiser/EventsList";
import ResaleMarketplace from "./pages/attendee/ResaleMarketplace";
import ResaleCheckout from "./pages/attendee/ResaleCheckout";
import SellerShell from "./shells/SellerShell";
import SellerDashboard from "./pages/seller/Dashboard";
import SellWizard from "./pages/seller/SellWizard";
import MyListings from "./pages/seller/MyListings";
import SoldHistory from "./pages/seller/SoldHistory";
import SellerWallet from "./pages/seller/Wallet";
import PayoutHistory from "./pages/seller/PayoutHistory";
import Help from "./pages/seller/Help";
import Contact from "./pages/seller/Contact";
import DisputeCentre from "./pages/seller/DisputeCentre";
import SellerProfile from "./pages/seller/Profile";
import OrganiserShell from "./shells/OrganiserShell";
import ControlCenter from "./pages/organiser/ControlCenter";
import Earnings from "./pages/organiser/Earnings";
import Reports from "./pages/organiser/Reports";
import MarketingAnalytics from "./pages/organiser/MarketingAnalytics";
import TicketCentral from "./pages/organiser/TicketCentral";
import AuditLookup from "./pages/organiser/AuditLookup";
import EventManagement from "./pages/organiser/EventManagement";
import CrowdControl from "./pages/organiser/CrowdControl";
import ScannerHub from "./pages/organiser/ScannerHub";
import LiveScanner from "./pages/organiser/LiveScanner";
import GuestLists from "./pages/organiser/GuestLists";
import ContractStatus from "./pages/organiser/ContractStatus";
import RoyaltyLedger from "./pages/organiser/RoyaltyLedger";
import ResaleCompliance from "./pages/organiser/ResaleCompliance";
import Attendance from "./pages/organiser/Attendance";
import RevenueBreakdown from "./pages/organiser/RevenueBreakdown";
import ExportCentre from "./pages/organiser/ExportCentre";
import OrganisationProfile from "./pages/organiser/OrganisationProfile";
import PayoutDetails from "./pages/organiser/PayoutDetails";
import TeamRoles from "./pages/organiser/TeamRoles";
import ScannerShell from "./shells/ScannerShell";
import ScannerSync from "./pages/scanner/Sync";
import ScannerScan from "./pages/scanner/Scan";
import AdminShell from "./shells/AdminShell";
import PlatformDashboard from "./pages/admin/PlatformDashboard";
import OrganiserAccounts from "./pages/admin/OrganiserAccounts";
import EventApprovals from "./pages/admin/EventApprovals";
import PlatformCosts from "./pages/admin/PlatformCosts";
import FeeConfiguration from "./pages/admin/FeeConfiguration";
import PayoutQueue from "./pages/admin/PayoutQueue";
import AdminResaleCompliance from "./pages/admin/ResaleCompliance";
import FraudSignals from "./pages/admin/FraudSignals";
import AdminAuditLog from "./pages/admin/AuditLog";
import AdminUsers from "./pages/admin/AdminUsers";
import CommunicationCenter from "./pages/admin/CommunicationCenter";
import AdminNotifications from "./pages/admin/Notifications";
import FeatureFlags from "./pages/admin/FeatureFlags";
import ComponentsShowcase from "./pages/dev/ComponentsShowcase";

// spec.md build order (§9): 1 tokens, 2 components, 3 shells, 4 Attendee PWA,
// 5 Seller Portal, 6 Organiser Console, 7 Scanner PWA, 8 Platform Admin — all
// done, see the plan file for detail on each. §9 step 9 (polish pass) is
// next. Each surface owns
// its own ThemeProvider default inside its shell (Attendee/Seller = dark)
// rather than one global provider, since surfaces disagree on default theme.
function OrganizerSpellingRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/organizer/, "/organiser") + search} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToastProvider>
        <AuthProvider>
          <AuthErrorToast />
          <Routes>
            <Route
              path="/dev/components"
              element={
                <ThemeProvider surfaceDefault="dark">
                  <ComponentsShowcase />
                </ThemeProvider>
              }
            />

            <Route
              path="/login"
              element={
                <ThemeProvider surfaceDefault="dark">
                  <Login />
                </ThemeProvider>
              }
            />

            <Route element={<AttendeeShell />}>
              <Route path="/" element={<Landing />} />
              <Route path="/events" element={<Browse />} />
              <Route path="/events/:eventId" element={<EventDetail />} />
              <Route path="/resale" element={<ResaleMarketplace />} />
              <Route element={<RequireAuth />}>
                <Route path="/resale/:listingId" element={<ResaleCheckout />} />
                <Route path="/checkout/:eventId" element={<Checkout />} />
                <Route path="/confirmation/:ticketId" element={<Confirmation />} />
                <Route path="/tickets" element={<MyTickets />} />
                <Route path="/tickets/:ticketId" element={<TicketCredential />} />
                <Route path="/profile" element={<Profile />} />
                {/* The old Account page grew into the cross-role profile. */}
                <Route path="/account" element={<Navigate to="/profile" replace />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="/seller" element={<SellerShell />}>
                <Route index element={<SellerDashboard />} />
                <Route path="sell" element={<SellWizard />} />
                <Route path="listings" element={<MyListings />} />
                <Route path="sold" element={<SoldHistory />} />
                <Route path="wallet" element={<SellerWallet />} />
                <Route path="payouts" element={<PayoutHistory />} />
                <Route path="help" element={<Help />} />
                <Route path="contact" element={<Contact />} />
                <Route path="disputes" element={<DisputeCentre />} />
                <Route path="profile" element={<SellerProfile />} />
              </Route>
            </Route>

            <Route element={<RequireOrgMembership />}>
              <Route path="/organiser" element={<OrganiserShell />}>
                <Route index element={<ControlCenter />} />
                <Route path="earnings" element={<Earnings />} />
                <Route path="reports" element={<Reports />} />
                <Route path="marketing" element={<MarketingAnalytics />} />
                <Route path="tickets" element={<TicketCentral />} />
                <Route path="audit" element={<AuditLookup />} />
                <Route path="events" element={<EventsList />} />
                <Route path="events/new" element={<EventManagement />} />
                <Route path="events/:eventId/edit" element={<EventManagement />} />
                <Route path="crowd-control" element={<CrowdControl />} />
                <Route path="scanners" element={<ScannerHub />} />
                <Route path="scan" element={<LiveScanner />} />
                <Route path="guests" element={<GuestLists />} />
                <Route path="contract" element={<ContractStatus />} />
                <Route path="royalties" element={<RoyaltyLedger />} />
                <Route path="compliance" element={<ResaleCompliance />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="revenue" element={<RevenueBreakdown />} />
                <Route path="exports" element={<ExportCentre />} />
                <Route path="profile" element={<OrganisationProfile />} />
                <Route path="payouts" element={<PayoutDetails />} />
                <Route path="team" element={<TeamRoles />} />
              </Route>
            </Route>

            {/* The US spelling is what people type; keep any sub-path. */}
            <Route path="/organizer/*" element={<OrganizerSpellingRedirect />} />

            <Route path="/scanner" element={<ScannerShell />}>
              <Route index element={<ScannerSync />} />
              <Route element={<RequireDeviceToken />}>
                <Route path="scan" element={<ScannerScan />} />
              </Route>
            </Route>

            <Route element={<RequirePlatformAdmin />}>
              <Route path="/admin" element={<AdminShell />}>
                <Route index element={<PlatformDashboard />} />
                <Route path="organisers" element={<OrganiserAccounts />} />
                <Route path="events" element={<EventApprovals />} />
                <Route path="costs" element={<PlatformCosts />} />
                <Route path="fees" element={<FeeConfiguration />} />
                <Route path="payouts" element={<PayoutQueue />} />
                <Route path="compliance" element={<AdminResaleCompliance />} />
                <Route path="fraud" element={<FraudSignals />} />
                <Route path="audit" element={<AdminAuditLog />} />
                <Route path="admins" element={<AdminUsers />} />
                <Route path="broadcasts" element={<CommunicationCenter />} />
                <Route path="notifications" element={<AdminNotifications />} />
                <Route path="flags" element={<FeatureFlags />} />
              </Route>
            </Route>

          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
