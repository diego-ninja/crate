import { useCallback, useEffect, useRef, useState } from "react";

import { type AuthUser } from "@/contexts/auth-context";
import { applyAuthenticatedUser } from "@/contexts/auth-runtime";
import { api } from "@/lib/api";

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async (): Promise<AuthUser | null> => {
    authRequestRef.current?.abort();
    const controller = new AbortController();
    authRequestRef.current = controller;
    setLoading(true);

    try {
      const data = await api<AuthUser>("/api/auth/me", "GET", undefined, {
        signal: controller.signal,
      });
      const nextUser = data && data.id ? data : null;
      setUser(nextUser);
      applyAuthenticatedUser(nextUser);
      return nextUser;
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return null;
      }
      setUser(null);
      applyAuthenticatedUser(null);
      return null;
    } finally {
      if (authRequestRef.current === controller) {
        authRequestRef.current = null;
        // The identity guard prevents an older request from clearing a newer one.
        // react-doctor-disable-next-line no-loading-flag-reset-outside-finally
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
