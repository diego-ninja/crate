import { useEffect, useState } from "react";

import { cn } from "@crate-ui/lib/cn";

interface ProviderConfig {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

interface OAuthButtonsProps {
  /** Where to redirect after successful auth */
  returnTo?: string | null;
  /** Invite token to append to OAuth URL (listen registration flow) */
  inviteToken?: string;
  /** Fetcher for /api/auth/providers — injected so the shared component
   *  doesn't depend on any app-specific API client */
  fetchProviders: () => Promise<Record<string, ProviderConfig>>;
  /** Build the full OAuth redirect URL. Receives the provider's login_url
   *  and returnTo. The app handles platform-specific logic (Capacitor
   *  native browser, invite tokens, etc.) */
  onOAuthNavigate: (loginUrl: string, returnTo: string | null, inviteToken?: string) => void;
  /** Button border-radius class */
  buttonClassName?: string;
}

export function OAuthButtons({
  returnTo = "/",
  inviteToken,
  fetchProviders,
  onOAuthNavigate,
  buttonClassName = "rounded-full",
}: OAuthButtonsProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});

  useEffect(() => {
    fetchProviders().then(setProviders).catch(() => {});
  }, [fetchProviders]);

  const google = providers.google;
  const apple = providers.apple;
  const hasAny = (google?.enabled && google?.configured) || apple?.enabled;

  if (!hasAny) return null;

  function handleOAuth(item: ProviderConfig) {
    if (!item.configured || !item.login_url) return;
    onOAuthNavigate(item.login_url, returnTo ?? null, inviteToken);
  }

  return (
    <>
      <div className="relative flex items-center gap-3 py-1">
        <div className="flex-1 border-t border-white/10" />
        <span className="text-xs text-white/40">or</span>
        <div className="flex-1 border-t border-white/10" />
      </div>

      <div className="flex items-center justify-center gap-3">
        {google?.enabled ? (
          <button
            type="button"
            disabled={!google.configured}
            onClick={() => handleOAuth(google)}
            className={cn(
              "flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 transition-colors hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed",
              buttonClassName,
            )}
            aria-label="Continue with Google"
            title="Continue with Google"
          >
            <GoogleIcon className="h-5 w-5" />
          </button>
        ) : null}
        {apple?.enabled ? (
          <button
            type="button"
            disabled={!apple.configured}
            onClick={() => apple.configured && handleOAuth(apple)}
            className={cn(
              "flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed",
              buttonClassName,
            )}
            aria-label="Continue with Apple"
            title={apple.configured ? "Continue with Apple" : "Apple Sign In — coming soon"}
          >
            <AppleIcon className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    </>
  );
}
