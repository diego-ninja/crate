import { useCallback } from "react";

import { api, getApiBase } from "@/lib/api";
import { isNative, platform } from "@/lib/capacitor";
import { OAuthButtons as OAuthButtonsBase } from "@crate/ui/domain/auth/OAuthButtons";

interface OAuthButtonsProps {
  returnTo?: string;
  inviteToken?: string;
}

const fetchProviders = () => api<Record<string, { enabled: boolean; configured: boolean; login_url: string | null }>>("/api/auth/providers");

function associatedListenOrigin(base: string): string | null {
  try {
    const { hostname, protocol } = new URL(base);
    if (protocol !== "https:") return null;
    if (hostname === "listen.lespedants.org") return "https://listen.lespedants.org";
    if (hostname === "api.lespedants.org" || hostname === "admin.lespedants.org") {
      return "https://listen.lespedants.org";
    }
    if (hostname === "listen.dev.lespedants.org") return "https://listen.dev.lespedants.org";
    if (hostname === "api.dev.lespedants.org" || hostname === "admin.dev.lespedants.org") {
      return "https://listen.dev.lespedants.org";
    }
  } catch {
    return null;
  }
  return null;
}

function nativeOAuthCallbackUrl(base: string, returnTo: string | null): URL {
  const universalOrigin = platform === "ios" ? associatedListenOrigin(base) : null;
  const callbackUrl = universalOrigin
    ? new URL("/auth/callback", universalOrigin)
    : new URL("cratemusic://oauth/callback");
  if (returnTo && returnTo !== "/") callbackUrl.searchParams.set("next", returnTo);
  return callbackUrl;
}

export function OAuthButtons({ returnTo = "/", inviteToken }: OAuthButtonsProps) {
  const handleNavigate = useCallback((loginUrl: string, rt: string | null, invite?: string) => {
    const base = getApiBase() || window.location.origin;
    const target = new URL(loginUrl, base);
    if (invite) target.searchParams.set("invite", invite);
    if (isNative) {
      const callbackUrl = nativeOAuthCallbackUrl(base, rt);
      target.searchParams.set("return_to", callbackUrl.toString());
      target.searchParams.set("app_id", `listen-${platform}`);
      import("@capacitor/browser").then(({ Browser }) => {
        Browser.open({ url: target.toString() });
      });
    } else {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (rt && rt !== "/") callbackUrl.searchParams.set("next", rt);
      target.searchParams.set("return_to", callbackUrl.toString());
      window.location.href = target.toString();
    }
  }, []);

  return (
    <OAuthButtonsBase
      returnTo={returnTo}
      inviteToken={inviteToken}
      fetchProviders={fetchProviders}
      onOAuthNavigate={handleNavigate}
      buttonClassName="rounded-full"
    />
  );
}
