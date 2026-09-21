import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Once a person explicitly toggles the theme, that choice sticks everywhere
// (localStorage) until they change it again. Until then, each surface shows
// its own spec'd default — Attendee/Seller/Scanner dark, Organiser/Admin light.
const OVERRIDE_KEY = "chaintix_theme_override";

const ThemeContext = createContext(null);

export function ThemeProvider({ surfaceDefault = "dark", children }) {
  const [override, setOverride] = useState(() => localStorage.getItem(OVERRIDE_KEY));
  const theme = override || surfaceDefault;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    localStorage.setItem(OVERRIDE_KEY, next);
    setOverride(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
