import { useCallback } from "react";

import { api, getApiBase } from "@/lib/api";
import { isNative } from "@/lib/capacitor";
import { OAuthButtons as OAuthButtonsBase } from "@crate-ui/domain/auth/OAuthButtons";

interface OAuthButtonsProps {
  returnTo?: string;
  inviteToken?: string;
}

const fetchProviders = () => api<Record<string, { enabled: boolean; configured: boolean; login_url: string | null }>>("/api/auth/providers");

export function OAuthButtons({ returnTo = "/", inviteToken }: OAuthButtonsProps) {
  const handleNavigate = useCallback((loginUrl: string, rt: string | null, invite?: string) => {
    const base = getApiBase() || window.location.origin;
    const target = new URL(loginUrl, base);
    if (invite) target.searchParams.set("invite", invite);
    if (isNative) {
      target.searchParams.set("return_to", "cratemusic://oauth/callback");
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
