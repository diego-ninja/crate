import { setAuthTokens } from "@/lib/api";

const OAUTH_NEXT_KEY = "crate-oauth-next";

function storePendingOAuthNext(next: string): void {
  try {
    localStorage.setItem(OAUTH_NEXT_KEY, next || "/");
  } catch {
    // Ignore storage failures; the token is still persisted separately.
  }
}

export function consumePendingOAuthNext(): string | null {
  try {
    const next = localStorage.getItem(OAUTH_NEXT_KEY);
    if (next) localStorage.removeItem(OAUTH_NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

export function getOAuthCallbackPayload(
  search: string | URLSearchParams,
): { token: string | null; refreshToken: string | null; next: string } {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    token: params.get("token"),
    refreshToken: params.get("refresh_token"),
    next: params.get("next") || "/",
  };
}

export function persistOAuthCallbackPayload(
  search: string | URLSearchParams,
): { handled: boolean; next: string } {
  const { token, refreshToken, next } = getOAuthCallbackPayload(search);
  if (!token) {
    return { handled: false, next };
  }

  setAuthTokens(token, refreshToken ?? undefined);
  storePendingOAuthNext(next);
  return { handled: true, next };
}

export async function consumeOAuthCallbackUrl(
  url: string,
): Promise<{ handled: boolean; next: string }> {
  try {
    const parsed = new URL(url);
    const isCustomSchemeCallback =
      parsed.protocol === "cratemusic:"
      && parsed.hostname === "oauth"
      && parsed.pathname === "/callback";
    const isUniversalLinkCallback =
      parsed.protocol === "https:"
      && parsed.pathname === "/auth/callback";

    if (!isCustomSchemeCallback && !isUniversalLinkCallback) {
      return { handled: false, next: "/" };
    }

    const result = persistOAuthCallbackPayload(parsed.searchParams);
    if (!result.handled) {
      return result;
    }
    void import("@capacitor/browser")
      .then(({ Browser }) => Browser.close().catch(() => {}))
      .catch(() => {});

    return result;
  } catch {
    return { handled: false, next: "/" };
  }
}
