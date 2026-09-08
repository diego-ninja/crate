import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { isTauriRuntime } from "@/lib/platform";

import type {
  BandcampCounts,
  BandcampStatus,
  BandcampTaskDetail,
  BandcampTaskResponse,
} from "./bandcamp-types";

interface BandcampCookieEventPayload {
  cookie?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useBandcampConnection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BandcampStatus | null>(null);
  const [counts, setCounts] = useState<BandcampCounts>({
    collection: 0,
    wishlist: 0,
    following: 0,
  });
  const [bandcampCookie, setBandcampCookie] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadBandcamp = useCallback(async () => {
    const nextStatus = await api<BandcampStatus>("/api/bandcamp/me/status");
    setStatus(nextStatus);
    if (!nextStatus.connected) {
      setCounts({ collection: 0, wishlist: 0, following: 0 });
      return;
    }
    const [collection, wishlist, following] = await Promise.all([
      api<{ total: number }>("/api/bandcamp/me/collection").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/wishlist").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/following").catch(() => ({
        total: 0,
      })),
    ]);
    setCounts({
      collection: collection.total || 0,
      wishlist: wishlist.total || 0,
      following: following.total || 0,
    });
  }, []);

  const connectWithCookie = useCallback(
    async (
      cookie: string,
      connectionMethod: "manual_cookie" | "native_desktop" = "manual_cookie",
    ) => {
      const trimmedCookie = cookie.trim();
      if (!trimmedCookie) {
        toast.error(t("settings.bandcamp.toasts.cookieRequired"));
        return;
      }
      setBusy(
        connectionMethod === "native_desktop"
          ? "tauri-connect"
          : "cookie-connect",
      );
      try {
        await api<BandcampStatus>("/api/bandcamp/me/connect/cookie", "POST", {
          cookie: trimmedCookie,
          connection_method: connectionMethod,
        });
        toast.success(t("settings.bandcamp.toasts.connected"));
        setBandcampCookie("");
        await loadBandcamp();
      } catch (error) {
        toast.error(
          (error as Error).message ||
            t("settings.bandcamp.toasts.connectFailed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [loadBandcamp, t],
  );

  useEffect(() => {
    loadBandcamp().catch(() => {});
  }, [loadBandcamp]);

  useEffect(() => {
    if (!isTauriRuntime) return;

    const handleBandcampCookie = (event: Event) => {
      const payload = (event as CustomEvent<BandcampCookieEventPayload>).detail;
      if (!payload?.cookie) return;
      void connectWithCookie(payload.cookie, "native_desktop");
    };

    window.addEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    return () => {
      window.removeEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    };
  }, [connectWithCookie]);

  const openTauriBandcampInterceptor = useCallback(async () => {
    if (!window.__crateTauriInvoke) {
      toast.error(t("settings.bandcamp.toasts.desktopUnavailable"));
      return;
    }
    setBusy("tauri-connect");
    try {
      await window.__crateTauriInvoke("open_bandcamp_cookie_interceptor");
      toast.info(t("settings.bandcamp.toasts.finishLogin"));
      window.setTimeout(
        () => {
          setBusy((current) => (current === "tauri-connect" ? null : current));
        },
        5 * 60 * 1000,
      );
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.openLoginFailed"),
      );
      setBusy(null);
    }
  }, [t]);

  const syncBandcamp = useCallback(async () => {
    setBusy("sync");
    try {
      const result = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/sync",
        "POST",
      );
      toast.success(t("settings.bandcamp.toasts.syncStarted"));
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await delay(1500);
        const task = await api<BandcampTaskDetail>(
          `/api/tasks/${encodeURIComponent(result.task_id)}`,
        );
        if (task.status === "completed") {
          await loadBandcamp();
          const synced = task.result?.synced;
          const importsQueued = task.result?.imports_queued ?? 0;
          const skippedExisting = task.result?.imports_skipped_existing ?? 0;
          const suffix = [
            synced != null
              ? t("settings.bandcamp.syncSummary.synced", { count: synced })
              : null,
            importsQueued
              ? t("settings.bandcamp.syncSummary.importsQueued", {
                  count: importsQueued,
                })
              : null,
            skippedExisting
              ? t("settings.bandcamp.syncSummary.alreadyInCrate", {
                  count: skippedExisting,
                })
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          toast.success(
            suffix
              ? t("settings.bandcamp.toasts.syncCompleteWithSummary", {
                  summary: suffix,
                })
              : t("settings.bandcamp.toasts.syncComplete"),
          );
          return;
        }
        if (task.status === "failed" || task.status === "cancelled") {
          toast.error(task.error || t("settings.bandcamp.toasts.syncFailed"));
          return;
        }
      }
      toast.info(t("settings.bandcamp.toasts.syncBackground"));
    } catch (error) {
      toast.error(
        (error as Error).message || t("settings.bandcamp.toasts.syncFailed"),
      );
    } finally {
      setBusy(null);
    }
  }, [loadBandcamp, t]);

  const disconnectBandcamp = useCallback(async () => {
    setBusy("disconnect");
    try {
      await api("/api/bandcamp/me/disconnect", "POST");
      toast.success(t("settings.bandcamp.toasts.disconnected"));
      await loadBandcamp();
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.disconnectFailed"),
      );
    } finally {
      setBusy(null);
    }
  }, [loadBandcamp, t]);

  return {
    bandcampCookie,
    busy,
    connectWithCookie,
    counts,
    disconnectBandcamp,
    isTauriRuntime,
    openTauriBandcampInterceptor,
    setBandcampCookie,
    status,
    syncBandcamp,
  };
}
