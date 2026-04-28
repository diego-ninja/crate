import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  avatar?: string;
  username?: string | null;
  bio?: string | null;
  connected_accounts?: Array<{ provider: string; status: string }>;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
  isAdmin: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const lastHeartbeatAtRef = useRef(0);

  const fetchUser = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/api/auth/me");
      if (data && data.id) setUser(data);
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (!user) return;
    async function sendHeartbeat(force = false) {
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastHeartbeatAtRef.current < 55_000) return;
      lastHeartbeatAtRef.current = now;
      await api("/api/auth/heartbeat", "POST", { app_id: "admin-web" }).catch(() => {});
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

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore
    }
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        isAdmin: user?.role === "admin",
        refetch: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
