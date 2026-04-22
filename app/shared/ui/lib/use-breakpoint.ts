import { useState, useEffect } from "react";

const isServer = typeof window === "undefined";

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => (isServer ? false : window.matchMedia("(min-width: 768px)").matches),
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
