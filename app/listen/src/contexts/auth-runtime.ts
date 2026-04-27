import type { AuthUser } from "@/contexts/auth-context";
import {
  primeOfflineRuntimeProfile,
  setActiveOfflineProfileKey,
  syncOfflineProfileToServiceWorker,
} from "@/lib/offline";
import { clearQueue as clearPlayEventQueue } from "@/lib/play-event-queue";

const AUTH_USER_ID_KEY = "listen-auth-user-id";
const PLAYER_STATE_KEY = "listen-player-state";
const RECENTLY_PLAYED_KEY = "listen-recently-played";

function safeRemoveStorageItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function safeSetStorageItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

export function resetPlaybackPersistence() {
  safeRemoveStorageItem(PLAYER_STATE_KEY);
  safeRemoveStorageItem(RECENTLY_PLAYED_KEY);
}

export function resetStoredAuthUser() {
  safeRemoveStorageItem(AUTH_USER_ID_KEY);
}

export function applyAuthenticatedUser(user: AuthUser | null) {
  if (user?.id) {
    const previousUserId = localStorage.getItem(AUTH_USER_ID_KEY);
    if (previousUserId && previousUserId !== String(user.id)) {
      resetPlaybackPersistence();
      clearPlayEventQueue();
    }
    safeSetStorageItem(AUTH_USER_ID_KEY, String(user.id));
    void primeOfflineRuntimeProfile();
    return;
  }

  setActiveOfflineProfileKey(null);
  void syncOfflineProfileToServiceWorker(null);
}

export function clearAuthRuntime(options: { clearStoredUser?: boolean } = {}) {
  const { clearStoredUser = true } = options;
  resetPlaybackPersistence();
  if (clearStoredUser) {
    resetStoredAuthUser();
  }
  clearPlayEventQueue();
  setActiveOfflineProfileKey(null);
  void syncOfflineProfileToServiceWorker(null);
}
