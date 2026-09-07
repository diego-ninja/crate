import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { api } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";

interface BandcampLinkState {
  entity_type?: string;
  entity_uid?: string;
  bandcamp_item_id?: number;
  item_url?: string | null;
  artist_url?: string | null;
  album_url?: string | null;
  user_owned?: boolean | null;
  user_downloadable?: boolean | null;
  latest_import_status?: string | null;
}

interface BandcampSupportButtonProps {
  entityType: "artist" | "album";
  entityUid?: string | null;
  fallbackArtistEntityUid?: string | null;
  className?: string;
  iconOnly?: boolean;
  presentation?: "default" | "secondary-action";
}

interface ResolvedBandcampLink {
  entityType: "artist" | "album";
  link: BandcampLinkState;
}

interface BandcampActionState {
  link: BandcampLinkState;
  resolvedEntityType: ResolvedBandcampLink["entityType"];
  url: string;
  ownedAlbum: boolean;
  canImport: boolean;
  label: string;
  ownedLabel: string;
  ownedShortLabel: string;
}

const SECONDARY_ACTION_CLASS =
  "inline-flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

function linkUrlForType(
  entityType: "artist" | "album",
  link: BandcampLinkState,
) {
  return entityType === "artist"
    ? link.artist_url || link.item_url || ""
    : link.album_url || link.item_url || "";
}

function resolveBandcampLink(
  entityType: "artist" | "album",
  link: BandcampLinkState,
): ResolvedBandcampLink | null {
  if (entityType === "artist") {
    return linkUrlForType("artist", link)
      ? { entityType: "artist", link }
      : null;
  }

  if (link.album_url || link.item_url) {
    return { entityType: "album", link };
  }

  return link.artist_url ? { entityType: "artist", link } : null;
}

async function fetchBandcampLink(
  entityType: "artist" | "album",
  entityUid: string,
) {
  const payload = await api<BandcampLinkState>(
    `/api/bandcamp/links/${entityType}/by-entity/${entityUid}`,
  );
  return resolveBandcampLink(entityType, payload);
}

function useBandcampLink(
  entityType: "artist" | "album",
  entityUid?: string | null,
  fallbackArtistEntityUid?: string | null,
) {
  const [resolved, setResolved] = useState<ResolvedBandcampLink | null>(null);

  useEffect(() => {
    if (!entityUid && !(entityType === "album" && fallbackArtistEntityUid)) {
      setResolved(null);
      return;
    }

    let cancelled = false;
    async function load() {
      const primary = entityUid
        ? await fetchBandcampLink(entityType, entityUid)
        : null;
      if (cancelled) return;
      if (primary) {
        setResolved(primary);
        return;
      }

      if (entityType === "album" && fallbackArtistEntityUid) {
        const fallback = await fetchBandcampLink(
          "artist",
          fallbackArtistEntityUid,
        );
        if (!cancelled) setResolved(fallback);
        return;
      }

      setResolved(null);
    }

    void load().catch(() => {
      if (!cancelled) setResolved(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityUid, fallbackArtistEntityUid]);

  return resolved;
}

function buildBandcampActionState(
  resolved: ResolvedBandcampLink,
  t: ReturnType<typeof useTranslation>["t"],
): BandcampActionState | null {
  const { entityType: resolvedEntityType, link } = resolved;
  const url = linkUrlForType(resolvedEntityType, link);
  if (!url) return null;

  const latestImportStatus = link.latest_import_status || "";
  const importInProgress = ["queued", "downloading", "importing"].includes(
    latestImportStatus,
  );
  const ownedAlbum = resolvedEntityType === "album" && Boolean(link.user_owned);
  const canImport = Boolean(
    ownedAlbum &&
      link.bandcamp_item_id &&
      link.user_downloadable &&
      latestImportStatus !== "completed" &&
      !importInProgress,
  );
  const ownedLabel = importInProgress
    ? t("bandcamp.support.importing")
    : t("bandcamp.support.owned");
  const ownedShortLabel = t("bandcamp.support.ownedShort");
  const label =
    resolvedEntityType === "artist"
      ? t("bandcamp.support.artist")
      : canImport
        ? t("bandcamp.support.import")
        : t("bandcamp.support.album");

  return {
    link,
    resolvedEntityType,
    url,
    ownedAlbum,
    canImport,
    label,
    ownedLabel,
    ownedShortLabel,
  };
}

function useBandcampActivation(
  state: BandcampActionState | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const [busy, setBusy] = useState(false);

  const activate = useCallback(async () => {
    if (!state) return;
    if (!state.canImport || !state.link.bandcamp_item_id) {
      await openExternalUrl(state.url);
      return;
    }

    setBusy(true);
    try {
      const result = await api<{ task_id: string }>(
        "/api/bandcamp/me/imports",
        "POST",
        { bandcamp_item_id: state.link.bandcamp_item_id, format: "flac" },
      );
      toast.success(
        t("bandcamp.toasts.importQueued", { taskId: result.task_id }),
      );
    } catch (error) {
      toast.error(
        (error as Error).message || t("bandcamp.toasts.importFailed"),
      );
    } finally {
      setBusy(false);
    }
  }, [state, t]);

  return { activate, busy };
}

function BandcampSecondaryAction({
  state,
  busy,
  className,
  onActivate,
}: {
  state: BandcampActionState;
  busy: boolean;
  className: string;
  onActivate: () => void;
}) {
  const ariaLabel =
    state.ownedAlbum && !state.canImport ? state.ownedLabel : state.label;

  if (state.ownedAlbum && !state.canImport) {
    return (
      <span
        className={`${SECONDARY_ACTION_CLASS} text-accent-action drop-shadow-accent-action ${className}`}
        aria-label={ariaLabel}
      >
        <BandcampLogo size={CRATE_ICON_SIZE.lg} />
        <span>Bandcamp</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={busy}
      className={`${SECONDARY_ACTION_CLASS} ${className}`}
      aria-label={ariaLabel}
    >
      {busy ? (
        <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
      ) : (
        <BandcampLogo size={CRATE_ICON_SIZE.lg} />
      )}
      <span>Bandcamp</span>
    </button>
  );
}

function BandcampDefaultAction({
  state,
  busy,
  className,
  iconOnly,
  onActivate,
}: {
  state: BandcampActionState;
  busy: boolean;
  className: string;
  iconOnly: boolean;
  onActivate: () => void;
}) {
  if (state.ownedAlbum && !state.canImport) {
    return (
      <span
        className={`bandcamp-support-owned inline-flex h-10 items-center rounded-full text-sm font-medium ${
          iconOnly ? "w-10 justify-center px-0" : "gap-2 px-4"
        } ${className}`}
        aria-label={state.ownedLabel}
      >
        <BandcampLogo size={15} />
        {iconOnly ? (
          <span className="sr-only">{state.ownedLabel}</span>
        ) : (
          <>
            <span className="hidden sm:inline">{state.ownedLabel}</span>
            <span className="sm:hidden">{state.ownedShortLabel}</span>
          </>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={busy}
      className={`bandcamp-support-action inline-flex h-10 items-center ${
        iconOnly ? "w-10 justify-center px-0" : "gap-2 px-4"
      } rounded-full text-sm font-medium disabled:opacity-50 ${className}`}
      aria-label={
        state.ownedAlbum && !state.canImport ? state.ownedLabel : state.label
      }
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <BandcampLogo size={15} />
      )}
      {iconOnly ? (
        <span className="sr-only">
          {state.ownedAlbum && !state.canImport
            ? state.ownedLabel
            : state.label}
        </span>
      ) : (
        <>
          <span className="hidden sm:inline">{state.label}</span>
          <span className="sm:hidden">Bandcamp</span>
        </>
      )}
    </button>
  );
}

export function BandcampSupportButton({
  entityType,
  entityUid,
  fallbackArtistEntityUid,
  className = "",
  iconOnly = false,
  presentation = "default",
}: BandcampSupportButtonProps) {
  const { t } = useTranslation();
  const resolved = useBandcampLink(
    entityType,
    entityUid,
    fallbackArtistEntityUid,
  );
  const state = resolved ? buildBandcampActionState(resolved, t) : null;
  const { activate, busy } = useBandcampActivation(state, t);

  if (!state) return null;
  if (presentation === "secondary-action") {
    return (
      <BandcampSecondaryAction
        state={state}
        busy={busy}
        className={className}
        onActivate={() => void activate()}
      />
    );
  }

  return (
    <BandcampDefaultAction
      state={state}
      busy={busy}
      className={className}
      iconOnly={iconOnly}
      onActivate={() => void activate()}
    />
  );
}
