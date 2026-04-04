import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";

interface NavidromeSyncIdentity {
  provider: string;
  status: "unlinked" | "pending" | "synced" | "errored";
  external_username?: string | null;
  last_error?: string | null;
  last_task_id?: string | null;
  last_synced_at?: string | null;
}

interface UserSyncPayload {
  navidrome_connected: boolean;
  navidrome: NavidromeSyncIdentity;
}

interface UserSyncContextValue {
  loading: boolean;
  navidromeConnected: boolean;
  navidromeStatus: NavidromeSyncIdentity["status"];
  navidromeUsername: string | null;
  navidromeLastError: string | null;
  canSyncToNavidrome: boolean;
  canUseNavidromeMutations: boolean;
  refetch: () => Promise<void>;
}

const UserSyncContext = createContext<UserSyncContextValue | null>(null);

const FALLBACK_PAYLOAD: UserSyncPayload = {
  navidrome_connected: false,
  navidrome: {
    provider: "navidrome",
    status: "unlinked",
    external_username: null,
    last_error: null,
    last_task_id: null,
    last_synced_at: null,
  },
};

export function UserSyncProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<UserSyncPayload>(FALLBACK_PAYLOAD);
  const userSyncRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    userSyncRequestRef.current?.abort();
    const controller = new AbortController();
    userSyncRequestRef.current = controller;
    setLoading(true);
    try {
      const data = await api<UserSyncPayload>("/api/me/sync", "GET", undefined, {
        signal: controller.signal,
      });
      setPayload(data || FALLBACK_PAYLOAD);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
      setPayload(FALLBACK_PAYLOAD);
    } finally {
      if (userSyncRequestRef.current === controller) {
        userSyncRequestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      userSyncRequestRef.current?.abort();
      userSyncRequestRef.current = null;
    };
  }, [refetch]);

  const value = useMemo<UserSyncContextValue>(() => {
    const navidrome = payload.navidrome || FALLBACK_PAYLOAD.navidrome;
    const synced = payload.navidrome_connected && navidrome.status === "synced";
    return {
      loading,
      navidromeConnected: payload.navidrome_connected,
      navidromeStatus: navidrome.status,
      navidromeUsername: navidrome.external_username || null,
      navidromeLastError: navidrome.last_error || null,
      canSyncToNavidrome: synced,
      canUseNavidromeMutations: synced,
      refetch,
    };
  }, [loading, payload, refetch]);

  return (
    <UserSyncContext.Provider value={value}>
      {children}
    </UserSyncContext.Provider>
  );
}

export function useUserSync() {
  const value = useContext(UserSyncContext);
  if (!value) {
    throw new Error("useUserSync must be used within UserSyncProvider");
  }
  return value;
}
