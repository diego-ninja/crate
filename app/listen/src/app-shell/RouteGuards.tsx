import { useEffect, useState, type ReactNode } from "react";

import { Navigate, useLocation } from "react-router";

import { useAuth } from "@/contexts/AuthContext";
import { connectCacheEvents } from "@/lib/cache";
import { isNative } from "@/lib/capacitor";
import { getCurrentServer, SERVER_STORE_EVENT } from "@/lib/server-store";
import { AuthSpinner } from "@/app-shell/AppFallbacks";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    return connectCacheEvents();
  }, [user]);

  if (loading) {
    return <AuthSpinner />;
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

export function ServerGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [hasServer, setHasServer] = useState(() => !isNative || Boolean(getCurrentServer()));

  useEffect(() => {
    if (!isNative) return;
    const sync = () => setHasServer(Boolean(getCurrentServer()));
    window.addEventListener(SERVER_STORE_EVENT, sync);
    return () => window.removeEventListener(SERVER_STORE_EVENT, sync);
  }, []);

  if (!isNative) return <>{children}</>;
  if (hasServer) return <>{children}</>;
  if (location.pathname === "/server-setup") return <>{children}</>;
  return <Navigate to="/server-setup" replace />;
}
