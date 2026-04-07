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

import { api } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  avatar?: string | null;
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
      const data = await api<AuthUser>("/api/auth/me", "GET", undefined, {
        signal: controller.signal,
      });
      if (data && data.id) {
        // Clear player state if a different user logged in
        const prevUserId = localStorage.getItem("listen-auth-user-id");
        if (prevUserId && prevUserId !== String(data.id)) {
          try {
            localStorage.removeItem("listen-player-state");
            localStorage.removeItem("listen-recently-played");
          } catch { /* ignore */ }
        }
        try { localStorage.setItem("listen-auth-user-id", String(data.id)); } catch { /* ignore */ }
      }
      setUser(data && data.id ? data : null);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
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

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore logout errors and clear local auth state anyway
    }
    // Clear per-session player state so the next user doesn't see stale data
    try {
      localStorage.removeItem("listen-player-state");
      localStorage.removeItem("listen-recently-played");
    } catch { /* ignore */ }
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loading, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
