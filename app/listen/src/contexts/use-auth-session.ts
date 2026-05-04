import { useCallback, useEffect, useRef, useState } from "react";

import { type AuthUser } from "@/contexts/auth-context";
import { applyAuthenticatedUser } from "@/contexts/auth-runtime";
import { api } from "@/lib/api";
import {
  setActiveOfflineProfileKey,
  syncOfflineProfileToServiceWorker,
} from "@/lib/offline";

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    authRequestRef.current?.abort();
    const controller = new AbortController();
    authRequestRef.current = controller;
    setLoading(true);

    try {
      const data = await api<AuthUser>("/api/auth/me", "GET", undefined, { signal: controller.signal });
      const nextUser = data && data.id ? data : null;
      setUser(nextUser);
      applyAuthenticatedUser(nextUser);
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

  return {
    user,
    loading,
    refetch,
    setUser,
  };
}
