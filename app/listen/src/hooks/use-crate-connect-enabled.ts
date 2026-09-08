import { useEffect, useSyncExternalStore } from "react";

import {
  CONNECT_ENABLED_EVENT,
  fetchCrateConnectPreferences,
  isCrateConnectEnabled,
  refreshCrateConnectPreferences,
  resetCrateConnectPreferences,
} from "@/lib/crate-connect";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { onCacheInvalidation } from "@/lib/cache";

export function useCrateConnectEnabled(): boolean {
  const enabled = useSyncExternalStore(
    (onStoreChange) => {
      const refresh = () => onStoreChange();
      const reset = () => {
        resetCrateConnectPreferences();
        onStoreChange();
      };
      const refreshOnFocus = () => {
        onStoreChange();
      };
      window.addEventListener(CONNECT_ENABLED_EVENT, refresh);
      window.addEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
      window.addEventListener("focus", refreshOnFocus);
      const unsubscribeCache = onCacheInvalidation((scope) => {
        if (scope === "connect:preferences") onStoreChange();
      });
      return () => {
        unsubscribeCache();
        window.removeEventListener(CONNECT_ENABLED_EVENT, refresh);
        window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, reset);
        window.removeEventListener("focus", refreshOnFocus);
      };
    },
    isCrateConnectEnabled,
    () => false,
  );

  useEffect(() => {
    let cancelled = false;
    const refreshFromServer = (force = false) => {
      const request = force
        ? refreshCrateConnectPreferences()
        : fetchCrateConnectPreferences();
      void request
        .then(() => undefined)
        .catch(() => {
          if (!cancelled && !force) resetCrateConnectPreferences();
        });
    };
    refreshFromServer();
    const refreshOnFocus = () => refreshFromServer(true);
    const unsubscribeCache = onCacheInvalidation((scope) => {
      if (scope === "connect:preferences") refreshFromServer(true);
    });
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      unsubscribeCache();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  return enabled;
}
