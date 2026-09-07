import { ListMusic, Loader2, Search, Zap } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { searchTrackToTrack, trackIdentity } from "@/pages/jam-session-utils";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";

import type { JamQueuePanelProps } from "./JamQueueSections";

type JamQueueToolbarProps = Pick<
  JamQueuePanelProps,
  | "t"
  | "queueMode"
  | "isHost"
  | "queueItems"
  | "updatingRoomField"
  | "roomIsActive"
  | "toggleQueueMode"
  | "enableAutoDj"
  | "autoDjSuggestions"
  | "queueSearchInputRef"
  | "queueSearch"
  | "setQueueSearch"
  | "canEditQueue"
  | "queueSearchLoading"
  | "queueSearchResults"
  | "addSearchTrackToRoom"
  | "canAddToQueue"
>;

type JamQueueHeaderProps = Pick<
  JamQueueToolbarProps,
  "t" | "queueMode" | "queueItems"
>;

type JamQueueModeControlsProps = Pick<
  JamQueueToolbarProps,
  | "t"
  | "queueMode"
  | "isHost"
  | "updatingRoomField"
  | "roomIsActive"
  | "toggleQueueMode"
  | "enableAutoDj"
>;

type JamAutoDjSuggestionsProps = Pick<
  JamQueueToolbarProps,
  "t" | "queueMode" | "autoDjSuggestions"
>;

type JamQueueSearchProps = Pick<
  JamQueueToolbarProps,
  | "t"
  | "queueItems"
  | "queueSearchInputRef"
  | "queueSearch"
  | "setQueueSearch"
  | "canEditQueue"
  | "queueSearchLoading"
  | "queueSearchResults"
  | "addSearchTrackToRoom"
  | "canAddToQueue"
>;

function JamQueueHeader({ t, queueMode, queueItems }: JamQueueHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          {t("jam.room.sharedQueue")}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {queueMode === "auto_dj"
            ? t("jam.room.autoDjQueueSubtitle")
            : queueMode === "auto"
              ? t("jam.room.autoQueueSubtitle")
              : t("jam.room.manualQueueSubtitle")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="jam-chip rounded-full px-2.5 py-1 text-xs text-text-muted">
          {t("jam.room.queueTrackCount", { count: queueItems.length })}
        </div>
      </div>
    </div>
  );
}

function JamQueueModeControls(props: JamQueueModeControlsProps) {
  const {
    t,
    queueMode,
    isHost,
    updatingRoomField,
    roomIsActive,
    toggleQueueMode,
    enableAutoDj,
  } = props;

  return (
    <>
      {isHost ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={toggleQueueMode}
            disabled={updatingRoomField !== null || !roomIsActive}
            className="jam-accent-control flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs disabled:opacity-50"
          >
            <span>
              <span className="block font-medium">
                {queueMode === "auto" || queueMode === "auto_dj"
                  ? t("jam.room.switchToDjMode")
                  : t("jam.room.switchToAutoMode")}
              </span>
              <span className="jam-accent-text mt-0.5 block opacity-60">
                {queueMode === "auto" || queueMode === "auto_dj"
                  ? t("jam.room.autoModeHelp")
                  : t("jam.room.djModeHelp")}
              </span>
            </span>
            <Zap size={16} />
          </button>
          {queueMode !== "auto_dj" ? (
            <button
              type="button"
              onClick={enableAutoDj}
              disabled={updatingRoomField !== null || !roomIsActive}
              className="jam-info-chip flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs disabled:opacity-50"
            >
              <span>
                <span className="block font-medium">
                  {t("jam.room.switchToAutoDjMode")}
                </span>
                <span className="jam-info-text mt-0.5 block opacity-60">
                  {t("jam.room.autoDjModeHelp")}
                </span>
              </span>
              <Zap size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function JamAutoDjSuggestions({
  t,
  queueMode,
  autoDjSuggestions,
}: JamAutoDjSuggestionsProps) {
  return (
    <>
      {queueMode === "auto_dj" && autoDjSuggestions.length > 0 ? (
        <div className="jam-info-chip mt-3 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="jam-info-text text-xs font-semibold uppercase tracking-wide">
                {t("jam.room.autoDjSuggestions")}
              </div>
              <p className="jam-info-text mt-1 text-xs">
                {t("jam.room.autoDjSuggestionsHelp")}
              </p>
            </div>
            <Zap size={15} className="jam-info-text shrink-0" />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {autoDjSuggestions.slice(0, 4).map((track) => (
              <div
                key={trackIdentity(track)}
                className="jam-queue-item flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2"
              >
                {track.albumCover ? (
                  <CrateImage
                    src={track.albumCover}
                    alt=""
                    className=" size-9 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="jam-artwork-placeholder flex size-9 shrink-0 items-center justify-center rounded-md">
                    <ListMusic size={14} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-text-primary">
                    {track.title}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {track.artist}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function JamQueueSearch(props: JamQueueSearchProps) {
  const {
    t,
    queueItems,
    queueSearchInputRef,
    queueSearch,
    setQueueSearch,
    canEditQueue,
    queueSearchLoading,
    queueSearchResults,
    addSearchTrackToRoom,
    canAddToQueue,
  } = props;

  return (
    <div className="mt-4 space-y-2">
      <div className="jam-input flex items-center gap-2 rounded-lg px-3 py-2">
        <Search size={15} className="text-text-muted" />
        <input
          ref={queueSearchInputRef}
          value={queueSearch}
          onChange={(event) => setQueueSearch(event.target.value)}
          disabled={!canEditQueue}
          placeholder={
            canEditQueue
              ? t("jam.room.queueSearchPlaceholder")
              : t("jam.room.queueSearchDisabledPlaceholder")
          }
          className="h-8 min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
        />
        {queueSearchLoading ? (
          <Loader2 size={15} className="animate-spin text-accent-action" />
        ) : null}
      </div>
      {queueSearchResults.length > 0 ? (
        <div className="jam-dark-surface overflow-hidden rounded-xl border border-border-quiet">
          {queueSearchResults.map((track) => {
            const playable = searchTrackToTrack(track);
            const alreadyQueued = queueItems.some((item) =>
              playerTracksMatch(item.track, playable),
            );
            return (
              <button
                key={
                  playable.id ||
                  playable.path ||
                  `${track.artist}-${track.title}`
                }
                type="button"
                onClick={() => addSearchTrackToRoom(track)}
                disabled={alreadyQueued}
                title={
                  alreadyQueued
                    ? t("jam.toasts.trackAlreadyInQueue")
                    : undefined
                }
                className="jam-queue-search-item flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default disabled:opacity-45"
              >
                {playable.albumCover ? (
                  <CrateImage
                    src={playable.albumCover}
                    alt=""
                    className=" size-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="jam-artwork-placeholder flex size-10 items-center justify-center rounded-lg">
                    <ListMusic size={15} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {playable.title}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {playable.artist}
                    {playable.album ? ` · ${playable.album}` : ""}
                  </div>
                </div>
                <span className="jam-accent-text text-xs font-medium">
                  {canAddToQueue
                    ? t("jam.room.addToQueue")
                    : t("jam.room.suggestTrack")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function JamQueueToolbar(props: JamQueueToolbarProps) {
  return (
    <>
      <JamQueueHeader {...props} />
      <JamQueueModeControls {...props} />
      <JamAutoDjSuggestions {...props} />
      <JamQueueSearch {...props} />
    </>
  );
}
