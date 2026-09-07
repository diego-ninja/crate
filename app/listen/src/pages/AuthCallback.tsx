import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/contexts/AuthContext";
import {
  clearPendingOAuthNext,
  persistOAuthCallbackPayload,
} from "@/lib/capacitor";

function buildDesktopDeepLink(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("desktop") !== "tauri") return null;
  const token = params.get("token");
  if (!token) return null;

  const deepLink = new URL("cratemusic://oauth/callback");
  for (const key of ["token", "refresh_token", "access_expires_at", "next"]) {
    const value = params.get(key);
    if (value) deepLink.searchParams.set(key, value);
  }
  return deepLink.toString();
}

function openDesktopDeepLink(url: string): void {
  if (navigator.userAgent.includes("jsdom")) return;
  window.location.href = url;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading, refetch } = useAuth();
  const [desktopDeepLink, setDesktopDeepLink] = useState<string | null>(null);
  const nextRef = useRef("/");
  const awaitingAuthRef = useRef(false);

  useEffect(() => {
    const deepLink = buildDesktopDeepLink(window.location.search);
    if (deepLink) {
      setDesktopDeepLink(deepLink);
      openDesktopDeepLink(deepLink);
      return;
    }

    const { handled, next } = persistOAuthCallbackPayload(
      window.location.search,
    );
    if (!handled) {
      navigate("/login", { replace: true });
      return;
    }

    clearPendingOAuthNext();
    nextRef.current = next;
    awaitingAuthRef.current = true;
    void refetch();
  }, [navigate, refetch]);

  useEffect(() => {
    if (!awaitingAuthRef.current || loading) {
      return;
    }

    awaitingAuthRef.current = false;
    if (user) {
      navigate(nextRef.current, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [loading, navigate, user]);

  if (desktopDeepLink) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6 text-text-primary">
        <div className="w-full max-w-md rounded-[12px] border border-border-quiet bg-text-primary/[0.04] p-8 text-center shadow-card">
          <img
            src="/icons/logo.svg"
            alt="Crate"
            className="mx-auto mb-4 size-14"
          />
          <h1 className="text-2xl font-bold">{t("authCallback.title")}</h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            {t("authCallback.desktopHint")}
          </p>
          <a
            href={desktopDeepLink}
            className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-accent-action px-6 text-sm font-semibold text-accent-action-foreground transition hover:bg-accent-action-hover"
          >
            {t("authCallback.openCrate")}
          </a>
        </div>
      </div>
    );
  }

  return null;
}
