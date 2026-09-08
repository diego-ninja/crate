import { getListenAppId, usesConfigurableServer } from "@/lib/platform";
import {
  getCurrentServer,
  setCurrentServerAuthTokens,
  setCurrentServerRefreshToken,
  setCurrentServerToken,
} from "@/lib/server-store";
import {
  getListenDeviceFingerprint,
  getListenDeviceLabel,
} from "@/lib/listen-device";

export const AUTH_TOKEN_EVENT = "crate:auth-token-updated";

// In Capacitor, the token lives on the ServerConfig — every server can
// have its own session. On web, the HttpOnly session cookie is authoritative.
let webAuthToken: string | null = null;
let webAuthTokenExpiresAt: string | null = null;

export function getAuthToken(): string | null {
  if (usesConfigurableServer) return getCurrentServer()?.token ?? null;
  return webAuthToken;
}

export function getAuthTokenExpiresAt(): string | null {
  if (usesConfigurableServer) return getCurrentServer()?.tokenExpiresAt ?? null;
  return webAuthTokenExpiresAt;
}

export function getRefreshToken(): string | null {
  if (usesConfigurableServer) return getCurrentServer()?.refreshToken ?? null;
  return null;
}

function decodeJwtExpiresAt(token: string | null): string | null {
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number"
      ? new Date(decoded.exp * 1000).toISOString()
      : null;
  } catch {
    return null;
  }
}

function emitAuthTokenChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_EVENT));
  } catch {
    // ignore
  }
}

export function setAuthToken(
  token: string | null,
  accessExpiresAt?: string | null,
): void {
  setAuthTokens(token, token ? undefined : null, accessExpiresAt);
}

export function setRefreshToken(refreshToken: string | null): void {
  if (usesConfigurableServer) {
    setCurrentServerRefreshToken(refreshToken);
    return;
  }
  try {
    localStorage.removeItem("listen-auth-refresh-token");
  } catch {
    // ignore persistence failures
  }
}

export function setAuthTokens(
  token: string | null,
  refreshToken?: string | null,
  accessExpiresAt?: string | null,
): void {
  const nextAccessExpiresAt =
    accessExpiresAt === undefined ? decodeJwtExpiresAt(token) : accessExpiresAt;
  if (usesConfigurableServer) {
    if (refreshToken === undefined)
      setCurrentServerToken(token, nextAccessExpiresAt);
    else setCurrentServerAuthTokens(token, refreshToken, nextAccessExpiresAt);
    emitAuthTokenChange();
    return;
  }
  webAuthToken = token;
  webAuthTokenExpiresAt = nextAccessExpiresAt;
  emitAuthTokenChange();
}

export function getApiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (usesConfigurableServer) {
    const token = getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  headers["X-Crate-App"] = getListenAppId();
  headers["X-Device-Label"] = getListenDeviceLabel();
  headers["X-Device-Fingerprint"] = getListenDeviceFingerprint();
  return headers;
}
