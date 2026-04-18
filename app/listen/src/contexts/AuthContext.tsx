import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { api, setAuthToken } from "@/lib/api";
import { primeOfflineRuntimeProfile, setActiveOfflineProfileKey, syncOfflineProfileToServiceWorker } from "@/lib/offline";
import { clearQueue as clearPlayEventQueue } from "@/lib/play-event-queue";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  avatar?: string | null;
  username?: string | null;
  bio?: string | null;
  session_id?: string | null;
  connected_accounts?: Array<{ provider: string; status: string }>;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    authRequestRef.current?.abort();
    const controller = new AbortController();
    authRequestRef.current = controller;
    setLoading(true);
    try {
      const data = await api<AuthUser>("/api/auth/me");
      if (data && data.id) {
        const prevUserId = localStorage.getItem("listen-auth-user-id");
        if (prevUserId && prevUserId !== String(data.id)) {
          try {
            localStorage.removeItem("listen-player-state");
            localStorage.removeItem("listen-recently-played");
          } catch { /* ignore */ }
          // Drop queued play-events from the previous user so they don't
          // flush under this session's auth (would pollute another
          // user's stats and leak private listening history).
          clearPlayEventQueue();
        }
        try { localStorage.setItem("listen-auth-user-id", String(data.id)); } catch { /* ignore */ }
      }
      setUser(data && data.id ? data : null);
      if (data && data.id) {
        void primeOfflineRuntimeProfile();
      } else {
        setActiveOfflineProfileKey(null);
        void syncOfflineProfileToServiceWorker(null);
      }
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
      setActiveOfflineProfileKey(null);
      void syncOfflineProfileToServiceWorker(null);
      setUser(null);
    } finally {
      if (authRequestRef.current === controller) {
        authRequestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      authRequestRef.current?.abort();
      authRequestRef.current = null;
    };
  }, [refetch]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void api("/api/auth/heartbeat", "POST", { app_id: "listen-web" }).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore logout errors
    }
    setAuthToken(null);
    try {
      localStorage.removeItem("listen-player-state");
      localStorage.removeItem("listen-recently-played");
      localStorage.removeItem("listen-auth-user-id");
    } catch { /* ignore */ }
    // Drop pending telemetry — after logout we don't know whose auth
    // would flush them next.
    clearPlayEventQueue();
    setActiveOfflineProfileKey(null);
    void syncOfflineProfileToServiceWorker(null);
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loading, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
