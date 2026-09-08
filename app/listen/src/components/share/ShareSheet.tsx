import { useEffect, useMemo, useState } from "react";
import { Camera, Copy, Loader2, MessageCircle, Send, X } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AppModal } from "@crate/ui/primitives/AppModal";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  buildShareText,
  buildTelegramShareUrl,
  buildWhatsAppShareUrl,
  canShareInstagramStory,
  shareInstagramStory,
  subscribeShareRequests,
  type SharePayload,
} from "@/lib/social-share";
import { isNative } from "@/lib/capacitor-runtime";
import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";

export function ShareSheetHost() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [instagramAvailable, setInstagramAvailable] = useState(false);
  const [instagramBusy, setInstagramBusy] = useState(false);

  useEffect(() => subscribeShareRequests(setPayload), []);

  useEffect(() => {
    let cancelled = false;
    if (!payload || !isNative) {
      setInstagramAvailable(false);
      return;
    }
    canShareInstagramStory()
      .then((available) => {
        if (!cancelled) setInstagramAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setInstagramAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const shareText = useMemo(
    () => (payload ? buildShareText(payload) : ""),
    [payload],
  );

  if (!payload) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payload.url);
      toast.success(t("share.toasts.linkCopied"));
      setPayload(null);
    } catch {
      toast.error(t("share.toasts.copyFailed"));
    }
  };

  const openTarget = async (url: string) => {
    try {
      await openExternalUrl(url);
      setPayload(null);
    } catch {
      toast.error(t("share.toasts.targetFailed"));
    }
  };

  const shareToInstagram = async () => {
    setInstagramBusy(true);
    try {
      await shareInstagramStory(payload);
      setPayload(null);
    } catch (error) {
      toast.error(
        (error as Error).message || t("share.toasts.instagramFailed"),
      );
    } finally {
      setInstagramBusy(false);
    }
  };

  return (
    <AppModal
      open
      onClose={() => setPayload(null)}
      maxWidthClassName="sm:max-w-[420px]"
      panelClassName="listen-glass-panel overflow-hidden rounded-[12px]"
      overlayClassName="bg-surface-canvas/58"
      mobileSafeArea
    >
      <div className="relative overflow-hidden">
        <div className="relative flex items-start gap-3 border-b border-text-primary/8 bg-surface-canvas/[0.08] p-4 ">
          <SharePreviewImage payload={payload} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-action">
              {t("share.title", {
                kind: t(`share.kind.${payload.kind}`),
              })}
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-text-primary">
              {payload.title}
            </h2>
            {payload.subtitle ? (
              <p className="truncate text-sm text-text-muted">
                {payload.subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("share.closeMenu")}
            onClick={() => setPayload(null)}
            className="rounded-full border border-border-quiet bg-text-primary/[0.04] p-2 text-text-primary/50 transition hover:bg-text-primary/10 hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative space-y-2 p-4 ">
          <ShareAction
            icon={MessageCircle}
            title="WhatsApp"
            subtitle={t("share.whatsappSubtitle")}
            onClick={() => void openTarget(buildWhatsAppShareUrl(payload))}
          />
          <ShareAction
            icon={Send}
            title="Telegram"
            subtitle={t("share.telegramSubtitle")}
            onClick={() => void openTarget(buildTelegramShareUrl(payload))}
          />
          {isNative ? (
            <ShareAction
              icon={instagramBusy ? Loader2 : Camera}
              title={t("share.instagramStory")}
              subtitle={
                instagramAvailable
                  ? t("share.instagramAvailable")
                  : t("share.instagramUnavailable")
              }
              disabled={!instagramAvailable || instagramBusy}
              spinning={instagramBusy}
              onClick={() => void shareToInstagram()}
            />
          ) : null}
          <ShareAction
            icon={Copy}
            title={t("share.copyLink")}
            subtitle={shareText}
            onClick={() => void copyLink()}
          />
        </div>
      </div>
    </AppModal>
  );
}

function SharePreviewImage({ payload }: { payload: SharePayload }) {
  if (payload.imageUrl) {
    return (
      <CrateImage
        src={payload.imageUrl}
        alt=""
        className=" size-14 shrink-0 rounded-xl border border-border-quiet object-cover shadow-share-preview"
      />
    );
  }
  return (
    <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-accent-action/20 bg-accent-action/10 text-accent-action shadow-share-preview">
      <span className="text-lg font-black">C</span>
    </div>
  );
}

function ShareAction({
  icon: Icon,
  title,
  subtitle,
  disabled = false,
  spinning = false,
  onClick,
}: {
  icon: typeof Copy;
  title: string;
  subtitle: string;
  disabled?: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border border-border-quiet bg-surface-canvas/20 px-3 py-3 text-left transition",
        "hover:border-text-primary/20 hover:bg-text-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        disabled &&
          "cursor-not-allowed opacity-45 hover:border-border-quiet hover:bg-surface-canvas/20",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-quiet bg-text-primary/[0.06] text-accent-action shadow-share-action-icon backdrop-blur">
        <Icon size={19} className={spinning ? "animate-spin" : ""} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-text-primary">
          {title}
        </span>
        <span className="block truncate text-xs text-text-muted">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
