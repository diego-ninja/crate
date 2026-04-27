import { setAuthToken } from "@/lib/api";

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
): { token: string | null; next: string } {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    token: params.get("token"),
    next: params.get("next") || "/",
  };
}

export function persistOAuthCallbackPayload(
  search: string | URLSearchParams,
): { handled: boolean; next: string } {
  const { token, next } = getOAuthCallbackPayload(search);
  if (!token) {
    return { handled: false, next };
  }

  setAuthToken(token);
  storePendingOAuthNext(next);
  return { handled: true, next };
}

export async function consumeOAuthCallbackUrl(
  url: string,
): Promise<{ handled: boolean; next: string }> {
  if (!url.startsWith("cratemusic://oauth/callback")) {
    return { handled: false, next: "/" };
  }

  try {
    const result = persistOAuthCallbackPayload(new URL(url).searchParams);
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
