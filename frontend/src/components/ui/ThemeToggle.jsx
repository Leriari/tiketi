import { Sun, Moon } from "lucide-react";
import { useTheme } from "../../theme/ThemeProvider";
import { cn } from "../../lib/cn";

/** Sun/moon with label — spec §2.2 top bar. */
export default function ThemeToggle({ className }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-body-sm text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary transition-colors duration-150",
        className
      )}
      // Starts with the visible word so voice control ("click Dark") works.
      aria-label={`${isDark ? "Dark" : "Light"} theme, switch to ${isDark ? "light" : "dark"}`}
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
      {isDark ? "Dark" : "Light"}
    </button>
  );
}
