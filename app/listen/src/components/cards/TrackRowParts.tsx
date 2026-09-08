import { useId, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Disc3, Pause, Play } from "@crate/ui/icons";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlayerProgress } from "@/contexts/PlayerContext";
import { isOfflineBusy, type OfflineItemState } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import type { TrackRowData } from "@/components/cards/TrackRowModel";

function TrackRowPlaybackProgress({ isPlaying }: { isPlaying: boolean }) {
  const { currentTime, duration } = usePlayerProgress();
  const gradientId = useId().replace(/:/g, "");
  const size = 38;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress =
    Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(1, currentTime / duration))
      : 0;

  return (
    <span
      className="group/track-progress track-row-playback-progress relative isolate flex size-10 items-center justify-center overflow-visible rounded-full backdrop-blur-md"
      data-testid="track-row-playback-progress"
    >
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-aura pointer-events-none absolute -inset-[13px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] opacity-[0.64] blur-[1px]",
          isPlaying && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-rim pointer-events-none absolute inset-[4px] z-10 rounded-full opacity-70",
          isPlaying && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-core pointer-events-none absolute inset-[2px] z-20 rounded-full",
          isPlaying && "animate-crate-play-core-pulse",
        )}
      />
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-[1px] z-30 size-[calc(100%-2px)] -rotate-90 overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="track-row-playback-gradient-start" />
            <stop offset="48%" className="track-row-playback-gradient-mid" />
            <stop offset="100%" className="track-row-playback-gradient-end" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="track-row-playback-track"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth={stroke}
          className="track-row-playback-ring transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      {isPlaying ? (
        <Pause
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40"
          fill="currentColor"
        />
      ) : (
        <Play
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40 ml-0.5"
          fill="currentColor"
        />
      )}
    </span>
  );
}

export function TrackRowLeadingControl({
  cover,
  disabled,
  index,
  isActive,
  isPlaying,
  playControlLabel,
  showCoverThumb,
  trackNumber,
  onClick,
}: {
  cover?: string;
  disabled: boolean;
  index?: number;
  isActive: boolean;
  isPlaying: boolean;
  playControlLabel: string;
  showCoverThumb: boolean;
  trackNumber?: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const trackIndex = index != null ? index : trackNumber || "-";
  const playIcon = isActive ? (
    <TrackRowPlaybackProgress isPlaying={isPlaying} />
  ) : (
    <Play
      size={CRATE_ICON_SIZE.sm}
      className="text-text-primary mx-auto hidden md:group-hover:block"
    />
  );

  return (
    <button
      type="button"
      className={cn(
        showCoverThumb
          ? "relative h-12 w-12 shrink-0 rounded-md border-0 bg-transparent p-0 text-inherit"
          : "flex w-10 shrink-0 justify-center rounded-full border-0 bg-transparent p-0 text-center text-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/45 disabled:cursor-not-allowed",
      )}
      aria-label={playControlLabel}
      title={playControlLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {showCoverThumb ? (
        <>
          <TrackCoverThumb
            src={cover}
            iconSize={CRATE_ICON_SIZE.md}
            className="absolute inset-0 rounded-md"
          />
          <div className="track-row-cover-overlay absolute inset-0 flex items-center justify-center rounded-md transition-colors">
            {disabled ? null : isActive ? (
              <TrackRowPlaybackProgress isPlaying={isPlaying} />
            ) : (
              <Play
                size={CRATE_ICON_SIZE.md}
                className="track-row-cover-play-icon"
                fill="currentColor"
              />
            )}
          </div>
        </>
      ) : disabled ? (
        <span className="text-text-muted text-xs">{trackIndex}</span>
      ) : (
        <>
          <span className="text-text-muted text-xs md:group-hover:hidden">
            {trackIndex}
          </span>
          {playIcon}
        </>
      )}
    </button>
  );
}

function TrackRowArtistLink({
  globalArtistUid,
  navigate,
  track,
}: {
  globalArtistUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  track: TrackRowData;
}) {
  if (!globalArtistUid && !track.artist_id) return <>{track.artist}</>;

  return (
    <button
      type="button"
      className="border-0 bg-transparent p-0 text-left text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
      onClick={(event) => {
        event.stopPropagation();
        navigate(
          artistPagePath({
            artistId: track.artist_id,
            artistEntityUid: globalArtistUid
              ? track.artist_entity_uid
              : undefined,
            globalArtistUid,
            artistSlug: track.artist_slug,
            artistName: track.artist,
          }),
        );
      }}
    >
      {track.artist}
    </button>
  );
}

function TrackRowAlbumLink({
  globalAlbumUid,
  navigate,
  track,
}: {
  globalAlbumUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  track: TrackRowData;
}) {
  if (!globalAlbumUid && !track.album_id) return <>{track.album}</>;

  return (
    <button
      type="button"
      className="border-0 bg-transparent p-0 text-left text-text-muted hover:text-text-primary cursor-pointer transition-colors hover:underline"
      onClick={(event) => {
        event.stopPropagation();
        navigate(
          albumPagePath({
            albumId: track.album_id,
            albumEntityUid: globalAlbumUid ? track.album_entity_uid : undefined,
            globalAlbumUid,
            albumSlug: track.album_slug,
            artistEntityUid: track.artist_entity_uid,
            artistName: track.artist,
            albumName: track.album,
          }),
        );
      }}
    >
      {track.album}
    </button>
  );
}

function trackRowOfflineClass(state: OfflineItemState): string | undefined {
  if (state === "ready") return "track-row-offline-ready";
  if (isOfflineBusy(state)) return "track-row-offline-busy";
  if (state === "error") return "track-row-offline-error";
  return undefined;
}

export function TrackRowDetails({
  globalAlbumUid,
  globalArtistUid,
  navigate,
  offlineLabel,
  offlineState,
  showAlbum,
  showArtist,
  track,
}: {
  globalAlbumUid?: string;
  globalArtistUid?: string;
  navigate: ReturnType<typeof useNavigate>;
  offlineLabel: string | null;
  offlineState: OfflineItemState;
  showAlbum: boolean;
  showArtist: boolean;
  track: TrackRowData;
}) {
  if (!showArtist && !showAlbum && !offlineLabel) return null;

  return (
    <div className="text-text-muted truncate text-xs">
      {showArtist ? (
        <TrackRowArtistLink
          globalArtistUid={globalArtistUid}
          navigate={navigate}
          track={track}
        />
      ) : null}
      {showArtist && showAlbum && " · "}
      {showAlbum ? (
        <TrackRowAlbumLink
          globalAlbumUid={globalAlbumUid}
          navigate={navigate}
          track={track}
        />
      ) : null}
      {(showArtist || showAlbum) && offlineLabel && " · "}
      {offlineLabel ? (
        <span className={trackRowOfflineClass(offlineState)}>
          {offlineLabel}
        </span>
      ) : null}
    </div>
  );
}

export function TrackRowLikeControl({
  hasTrackRef,
  liked,
  toggleTrackLike,
  track,
}: {
  hasTrackRef: boolean;
  liked: boolean;
  toggleTrackLike: ReturnType<typeof useLikedTracks>["toggleTrackLike"];
  track: TrackRowData;
}) {
  if (!hasTrackRef) return <div className=" size-9 shrink-0" />;

  return (
    <FollowHeartButton
      className={` size-9 shrink-0 rounded-full transition-opacity ${
        liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
      }`}
      title={liked ? "Unlike" : "Like"}
      following={liked}
      heartTestId="track-like-heart"
      particlesTestId="track-like-particles"
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await toggleTrackLike(
            track.library_track_id ??
              (typeof track.id === "number" ? track.id : undefined),
            track.entity_uid ?? null,
            track.path || "",
            track.global_track_uid,
          );
        } catch {
          // Keep row interaction non-blocking; caller surfaces persistence elsewhere.
        }
      }}
      iconSize={CRATE_ICON_SIZE.md}
    />
  );
}

export function TrackRowActions({
  actionMenu,
  actions,
  cover,
  disabled,
  onActionMenuOpen,
  onSelectionActionMenuOpen,
  selectable,
  selected,
  showLocalActions,
  track,
}: {
  actionMenu: ReturnType<typeof useItemActionMenu>;
  actions: ReturnType<typeof useTrackActionEntries>;
  cover?: string;
  disabled: boolean;
  onActionMenuOpen?: () => void;
  onSelectionActionMenuOpen?: (
    track: TrackRowData,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean | void;
  selectable: boolean;
  selected: boolean;
  showLocalActions: boolean;
  track: TrackRowData;
}) {
  if (!showLocalActions || disabled) {
    return <div className=" size-9 shrink-0" />;
  }

  return (
    <>
      <div className="flex shrink-0 gap-[var(--content-row-inline-gap)] opacity-100 transition-opacity md:opacity-65 md:group-hover:opacity-100">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={(event) => {
            if (
              selectable &&
              selected &&
              onSelectionActionMenuOpen?.(track, event)
            ) {
              return;
            }
            onActionMenuOpen?.();
            actionMenu.openFromTrigger(event);
          }}
          onContextMenu={(event) => {
            onActionMenuOpen?.();
            actionMenu.handleContextMenu(event);
          }}
          className=" size-9"
        />
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: cover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </>
  );
}
