import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

  const refetch = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/api/auth/me");
      setUser(data && data.id ? data : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore logout errors and clear local auth state anyway
    }
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loading, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
