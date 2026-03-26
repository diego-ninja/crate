import { useState, useEffect, useCallback } from "react";

type Theme = "dark" | "light";

function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem("crate-theme") as Theme) || "dark";
  } catch {
    return "dark";
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem("crate-theme", t); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
