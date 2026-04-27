import {
  useContext,
  type ReactNode,
} from "react";

import {
  OfflineContext,
} from "@/contexts/offline-context";
import { useAuth } from "@/contexts/AuthContext";
import { useOfflineRuntime } from "@/contexts/use-offline-runtime";

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const value = useOfflineRuntime(user);

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const value = useContext(OfflineContext);
  if (!value) {
    throw new Error("useOffline must be used within OfflineProvider");
  }
  return value;
}
