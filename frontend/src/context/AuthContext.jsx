import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, usingMockBackend, setToken, clearToken, getToken } from "../api";

const AuthContext = createContext(null);

// Work Order 04 C1 — what the role-aware guards (C2) check. Only ever
// fetched from the real backend: mock mode has no real identity/role
// system to check against (the Organiser/Admin shells still run entirely
// on simulated data there — see C4), so guards pass through unrestricted
// when usingMockBackend is true rather than permanently locking users out
// of the one demo mode this app actually ships with by default.
const EMPTY_ROLES = { organisations: [], isPlatformAdmin: false };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("tiketi_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [roles, setRoles] = useState(EMPTY_ROLES);
  const [rolesLoaded, setRolesLoaded] = useState(usingMockBackend);

  const refreshRoles = useCallback(async () => {
    if (usingMockBackend || !getToken()) {
      setRoles(EMPTY_ROLES);
      setRolesLoaded(true);
      return;
    }
    try {
      const [me, organisations] = await Promise.all([api.me(), api.getMyOrganisations()]);
      setRoles({
        organisations: organisations.map((o) => ({ id: o.id, businessName: o.business_name, role: o.role })),
        isPlatformAdmin: Boolean(me.is_platform_admin),
      });
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

  const login = useCallback(async (phoneNumber) => {
    const data = await api.login(phoneNumber);
    setToken(data.access_token);
    const nextUser = { id: data.user_id, phoneNumber: data.phone_number };
    localStorage.setItem("tiketi_user", JSON.stringify(nextUser));
    setUser(nextUser);
    await refreshRoles();
    return nextUser;
  }, [refreshRoles]);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("tiketi_user");
    setUser(null);
    setRoles(EMPTY_ROLES);
  }, []);

  const isAuthed = Boolean(user && getToken());

  return (
    <AuthContext.Provider value={{ user, isAuthed, roles, rolesLoaded, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
