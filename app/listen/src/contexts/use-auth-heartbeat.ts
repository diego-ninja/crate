import { useEffect, useRef } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export function useAuthHeartbeat(user: AuthUser | null) {
  const lastHeartbeatAtRef = useRef(0);

  useEffect(() => {
    if (!user) return;

    async function sendHeartbeat(force = false) {
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastHeartbeatAtRef.current < 55_000) return;
      lastHeartbeatAtRef.current = now;
      await api("/api/auth/heartbeat", "POST", { app_id: "listen-web" }).catch(() => {});
    }

    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 60_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sendHeartbeat(true);
      }
    }

    function handleOnline() {
      void sendHeartbeat(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [user]);
}
