import { createContext, useContext, useState, useCallback } from "react";
import { api, setToken, clearToken, getToken } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("tiketi_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (phoneNumber) => {
    const data = await api.login(phoneNumber);
    setToken(data.access_token);
    const nextUser = { id: data.user_id, phoneNumber: data.phone_number };
    localStorage.setItem("tiketi_user", JSON.stringify(nextUser));
    setUser(nextUser);
    return nextUser;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("tiketi_user");
    setUser(null);
  }, []);

  const isAuthed = Boolean(user && getToken());

  return (
    <AuthContext.Provider value={{ user, isAuthed, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
