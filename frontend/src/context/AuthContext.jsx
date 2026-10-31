import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, usingMockBackend, setToken, clearToken, getToken } from "../api";
import { getActiveOrgId, setActiveOrgId } from "../activeOrg";

const AuthContext = createContext(null);

// Work Order 04 C1 — what the role-aware guards (C2) check. Only ever
// fetched from the real backend: mock mode has no real identity/role
// system to check against (the Organiser/Admin shells still run entirely
// on simulated data there — see C4), so guards pass through unrestricted
// when usingMockBackend is true rather than permanently locking users out
// of the one demo mode this app actually ships with by default.
// profileKnown: the account's name/email were actually loaded (not a failed
// or skipped load), so "missing" can be trusted — see ProfileGate in App.jsx.
const EMPTY_ROLES = { organisations: [], isPlatformAdmin: false, googleLinked: false, email: null, displayName: null, profileKnown: false };

// A stored token that can't possibly work against the current backend: a
// mock-mode token ("mock.<id>") after switching VITE_USE_MOCK off (or a real
// JWT after switching it on), or a real JWT whose `exp` has passed. Dropping
// these up front means loading the app with a stale session just shows you
// as logged out, instead of the first authenticated call 401-ing and
// bouncing you to /login from a public page.
function isUnusableToken(token) {
  if (!token) return true;
  const isMockToken = token.startsWith("mock.");
  if (isMockToken !== usingMockBackend) return true;
  if (isMockToken) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function loadStoredUser() {
  const raw = localStorage.getItem("tiketi_user");
  if (!raw || isUnusableToken(getToken())) {
    clearToken();
    localStorage.removeItem("tiketi_user");
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadStoredUser);
  const [roles, setRoles] = useState(EMPTY_ROLES);
  const [rolesLoaded, setRolesLoaded] = useState(usingMockBackend);
  // True right after an explicit logout. Lets the route guards send someone
  // who logs out *from a protected page* home, instead of treating them like
  // a visitor who needs to log in (which would land them on /login).
  const [loggedOut, setLoggedOut] = useState(false);
  // The organisation the Organiser Console is scoped to (see activeOrg.js).
  const [activeOrgId, setActiveOrgIdState] = useState(getActiveOrgId);

  const refreshRoles = useCallback(async () => {
    if (usingMockBackend || !getToken()) {
      setRoles(EMPTY_ROLES);
      setRolesLoaded(true);
      return;
    }
    try {
      const [me, organisations] = await Promise.all([api.me(), api.getMyOrganisations()]);
      setRoles({
        organisations: organisations.map((o) => ({ id: o.id, businessName: o.business_name, role: o.role, verificationStatus: o.verification_status })),
        isPlatformAdmin: Boolean(me.is_platform_admin),
        googleLinked: Boolean(me.google_linked),
        email: me.email || null,
        displayName: me.display_name || null,
        profileKnown: true,
      });
      // Keep the stored organisation if this user still belongs to it,
      // otherwise fall back to their first one.
      const stored = getActiveOrgId();
      const next = organisations.some((o) => o.id === stored) ? stored : organisations[0]?.id || null;
      setActiveOrgId(next);
      setActiveOrgIdState(next);
    } catch {
      // Expired/invalid token, network hiccup, etc. — fail closed (no
      // roles), not open. The guards (C2) treat "not loaded yet" and
      // "loaded as empty" the same way: no access.
      setRoles(EMPTY_ROLES);
    } finally {
      setRolesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (user && getToken()) refreshRoles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount

  // Shared by both auth paths below — a TokenResponse-shaped result
  // ({access_token, user_id, phone_number}) is all either one produces.
  const completeAuth = useCallback(async (data) => {
    setToken(data.access_token);
    const nextUser = { id: data.user_id, phoneNumber: data.phone_number };
    localStorage.setItem("tiketi_user", JSON.stringify(nextUser));
    setUser(nextUser);
    setLoggedOut(false);
    await refreshRoles();
    return nextUser;
  }, [refreshRoles]);

  // Mock-mode only in practice — the real backend 404s /auth/login outside
  // development (Work Order 05 A1). Kept because mockApi's login has no OTP
  // concept at all, and frontend/src/mock/ isn't touched by this work order.
  const login = useCallback(async (phoneNumber) => {
    const data = await api.login(phoneNumber);
    return completeAuth(data);
  }, [completeAuth]);

  // The real login path (Work Order 05 A2) — Login.jsx calls this after a
  // successful verify-otp.
  // googleLinkToken: links a Google account that's waiting for a phone.
  const loginWithOtp = useCallback(async (phoneNumber, otpCode, googleLinkToken) => {
    const data = await api.verifyOtp(phoneNumber, otpCode, googleLinkToken);
    return completeAuth(data);
  }, [completeAuth]);

  // Firebase sign-in (phone SMS or Google). Either signs in, or — a Google
  // account not yet linked to a phone — returns { needsPhone, linkToken,
  // email }: the login screen then verifies a phone with Firebase and calls
  // this again with that phone's token and the linkToken.
  // No-SMS deployments: finish a first Google sign-in with an unverified number.
  const completeGooglePhone = useCallback(async (linkToken, phoneNumber) => {
    const data = await api.googlePhone(linkToken, phoneNumber);
    return completeAuth(data);
  }, [completeAuth]);

  const loginWithFirebase = useCallback(async (idToken, googleLinkToken) => {
    const data = await api.firebaseLogin(idToken, googleLinkToken);
    if (data.needs_phone) return { needsPhone: true, linkToken: data.link_token, email: data.email };
    await completeAuth(data);
    return { needsPhone: false };
  }, [completeAuth]);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("tiketi_user");
    setActiveOrgId(null);
    setActiveOrgIdState(null);
    setUser(null);
    setRoles(EMPTY_ROLES);
    setLoggedOut(true);
  }, []);

  // Ends every other session for this account; this device gets a fresh
  // token so it stays signed in.
  const signOutEverywhere = useCallback(async () => {
    const data = await api.signOutEverywhere();
    setToken(data.access_token);
  }, []);

  const switchOrganisation = useCallback((id) => {
    setActiveOrgId(id);
    setActiveOrgIdState(id);
  }, []);

  const activeOrganisation = roles.organisations.find((o) => o.id === activeOrgId) || null;

  const isAuthed = Boolean(user && getToken());

  return (
    <AuthContext.Provider
      value={{
        user, isAuthed, loggedOut, roles, rolesLoaded, refreshRoles, login, loginWithOtp, loginWithFirebase, completeGooglePhone, logout,
        activeOrganisation, switchOrganisation, signOutEverywhere,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Which role-gated surfaces to *link to* for the current user — mirrors
// routeGuards.jsx (mock mode: everything; real backend: by role). Only
// decides what's shown in menus; the guards and the backend still decide
// what's allowed.
export function useSurfaceAccess() {
  const { isAuthed, roles } = useAuth();
  if (!isAuthed) return { organiser: false, admin: false };
  if (usingMockBackend) return { organiser: true, admin: true };
  return { organiser: roles.organisations.length > 0, admin: roles.isPlatformAdmin };
}
