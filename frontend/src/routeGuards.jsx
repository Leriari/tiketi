// Work Order 04 C2 — per-surface route guards. Guards are a usability
// feature, not a security feature: every rule here is already enforced on
// the real backend (app/core/authz.py); nothing here is load-bearing for
// security, it only spares an unauthorised user a confusing trip into a
// surface that would just 403 on every request.
//
// Mock mode has no real identity/role system to check against (the
// Organiser/Admin shells still run entirely on simulated data there — see
// C4), so these guards pass through unrestricted when usingMockBackend is
// true, rather than permanently locking the one demo mode this app ships
// with by default. They only actually gate anything once VITE_USE_MOCK=false.
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { usingMockBackend } from "./api";
import { useAuth } from "./context/AuthContext";
import { getDeviceToken } from "./scanner/deviceAuth";

function Unauthorised({ message }) {
  const location = useLocation();
  return <Navigate to="/" replace state={{ from: location, authError: message }} />;
}

export function RequireOrgMembership() {
  const { rolesLoaded, roles } = useAuth();
  if (usingMockBackend) return <Outlet />;
  if (!rolesLoaded) return null;
  if (roles.organisations.length === 0) {
    return <Unauthorised message="You need to belong to an organisation to access the Organiser Console." />;
  }
  return <Outlet />;
}

export function RequirePlatformAdmin() {
  const { rolesLoaded, roles } = useAuth();
  if (usingMockBackend) return <Outlet />;
  if (!rolesLoaded) return null;
  if (!roles.isPlatformAdmin) {
    return <Unauthorised message="Platform admin access is required for that page." />;
  }
  return <Outlet />;
}

export function RequireDeviceToken() {
  // The Scanner surface's own identity is the device token (B4), not a
  // user role — this guards /scanner/scan specifically (the scanning
  // function itself), never the index route, since that's precisely the
  // screen a not-yet-enrolled device needs to reach to get a token.
  if (usingMockBackend) return <Outlet />;
  if (!getDeviceToken()) {
    return <Navigate to="/scanner" replace state={{ authError: "Enrol this device before scanning." }} />;
  }
  return <Outlet />;
}
