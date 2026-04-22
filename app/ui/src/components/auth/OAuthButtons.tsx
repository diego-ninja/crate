import { useCallback } from "react";

import { api } from "@/lib/api";
import { OAuthButtons as OAuthButtonsBase } from "@crate/ui/domain/auth/OAuthButtons";

interface OAuthButtonsProps {
  returnTo?: string | null;
}

const fetchProviders = () => api<Record<string, { enabled: boolean; configured: boolean; login_url: string | null }>>("/api/auth/providers");

export function OAuthButtons({ returnTo }: OAuthButtonsProps) {
  const handleNavigate = useCallback((loginUrl: string, rt: string | null) => {
    const target = new URL(loginUrl, window.location.origin);
    target.searchParams.set("return_to", rt || `${window.location.origin}/`);
    window.location.href = target.toString();
  }, []);

  return (
    <OAuthButtonsBase
      returnTo={returnTo}
      fetchProviders={fetchProviders}
      onOAuthNavigate={handleNavigate}
      buttonClassName="rounded-md"
    />
  );
}
