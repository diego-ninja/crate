import {
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { api, setAuthToken } from "@/lib/api";
import {
  AuthContext,
} from "@/contexts/auth-context";
import { clearAuthRuntime } from "@/contexts/auth-runtime";
import { useAuthHeartbeat } from "@/contexts/use-auth-heartbeat";
import { useAuthOAuthSync } from "@/contexts/use-auth-oauth-sync";
import { useAuthSession } from "@/contexts/use-auth-session";

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading, refetch, setUser } = useAuthSession();

  useAuthOAuthSync({ navigate, refetch });
  useAuthHeartbeat(user);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore logout errors
    }
    setAuthToken(null);
    clearAuthRuntime();
    setUser(null);
    navigate("/login");
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loading, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
