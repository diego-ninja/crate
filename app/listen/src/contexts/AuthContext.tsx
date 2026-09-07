import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { api, setAuthToken } from "@/lib/api";
import { AuthContext } from "@/contexts/auth-context";
import { clearAuthRuntime } from "@/contexts/auth-runtime";
import { useAuthHeartbeat } from "@/contexts/use-auth-heartbeat";
import { useAuthOAuthSync } from "@/contexts/use-auth-oauth-sync";
import { useAuthSession } from "@/contexts/use-auth-session";
import { useAuthTokenRefresh } from "@/contexts/use-auth-token-refresh";
import { useListenWarmup } from "@/hooks/use-listen-warmup";
import { setSentryUser } from "@/lib/sentry";

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

  useEffect(() => {
    setSentryUser(user?.id ?? null);
  }, [user?.id]);

  useAuthOAuthSync({ navigate, refetch });
  useAuthTokenRefresh(user);
  useAuthHeartbeat(user);
  useListenWarmup(user);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore logout errors
    }
    clearAuthRuntime({ reason: "logout" });
    setAuthToken(null);
    setUser(null);
    navigate("/login");
  }, [navigate, setUser]);

  const value = useMemo(
    () => ({ user, loading, refetch, logout }),
    [user, loading, refetch, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
