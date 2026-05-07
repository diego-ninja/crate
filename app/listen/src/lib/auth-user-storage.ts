import { getApiBase } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";

export const AUTH_USER_ID_KEY = "listen-auth-user-id";

function getServerScope(serverOrigin?: string): string {
  const rawOrigin = serverOrigin || getApiBase() || (
    typeof window !== "undefined" ? window.location.origin : "listen"
  );
  try {
    return new URL(rawOrigin).origin.replace(/\/+$/, "");
  } catch {
    return rawOrigin.replace(/\/+$/, "");
  }
}

export function getAuthUserIdStorageKey(serverOrigin?: string): string {
  if (!isNative) return AUTH_USER_ID_KEY;
  return `${AUTH_USER_ID_KEY}:${encodeURIComponent(getServerScope(serverOrigin))}`;
}

function safeGetStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemoveStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function safeSetStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

export function getStoredAuthUserId(serverOrigin?: string): string | null {
  const scopedKey = getAuthUserIdStorageKey(serverOrigin);
  const scopedValue = safeGetStorageItem(scopedKey);
  if (scopedValue || scopedKey === AUTH_USER_ID_KEY) return scopedValue;

  const legacyValue = safeGetStorageItem(AUTH_USER_ID_KEY);
  if (legacyValue) {
    safeSetStorageItem(scopedKey, legacyValue);
    safeRemoveStorageItem(AUTH_USER_ID_KEY);
  }
  return legacyValue;
}

export function setStoredAuthUserId(userId: string | number, serverOrigin?: string): void {
  const scopedKey = getAuthUserIdStorageKey(serverOrigin);
  safeSetStorageItem(scopedKey, String(userId));
  if (scopedKey !== AUTH_USER_ID_KEY) {
    safeRemoveStorageItem(AUTH_USER_ID_KEY);
  }
}

export function removeStoredAuthUserId(serverOrigin?: string): void {
  const scopedKey = getAuthUserIdStorageKey(serverOrigin);
  safeRemoveStorageItem(scopedKey);
  if (scopedKey !== AUTH_USER_ID_KEY) {
    safeRemoveStorageItem(AUTH_USER_ID_KEY);
  }
}
