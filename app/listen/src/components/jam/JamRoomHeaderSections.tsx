import {
  Globe2,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pin,
  Plus,
  Radio,
  Zap,
} from "@crate/ui/icons";

import type { JamRoomHeroProps } from "./JamRoomHeroSections";
import { HeroActionButton, HeroPrimaryButton } from "./JamHeroButtons";

type JamRoomHeaderProps = Pick<
  JamRoomHeroProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
  | "isHost"
  | "currentTrackAlreadyQueued"
  | "queuePrimaryActionLabel"
  | "shareCurrentTrack"
  | "handlePlayRoomQueue"
  | "queueItems"
  | "roomActionsOpen"
  | "setRoomActionsOpen"
>;

type JamRoomIdentityProps = Pick<
  JamRoomHeaderProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
>;

type JamRoomHeaderActionsProps = Pick<
  JamRoomHeaderProps,
  | "t"
  | "isConnected"
  | "roomIsActive"
  | "isHost"
  | "currentTrackAlreadyQueued"
  | "queuePrimaryActionLabel"
  | "shareCurrentTrack"
  | "handlePlayRoomQueue"
  | "queueItems"
  | "roomActionsOpen"
  | "setRoomActionsOpen"
>;

type JamRoomMetaBadgesProps = Pick<
  JamRoomIdentityProps,
  "t" | "room" | "queueMode"
>;

type JamRoomConnectionBadgesProps = Pick<
  JamRoomIdentityProps,
  | "t"
  | "room"
  | "queueMode"
  | "isConnected"
  | "connectionProblem"
  | "roomIsActive"
>;

function JamRoomMetaBadges({ t, room, queueMode }: JamRoomMetaBadgesProps) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2.5">
      <h1 className="text-3xl font-bold text-text-primary">{room.name}</h1>
      <div className="jam-accent-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
        <Zap size={12} />
        {queueMode === "auto_dj"
          ? t("jam.room.autoDjMode")
          : queueMode === "auto"
            ? t("jam.room.autoMode")
            : t("jam.room.djMode")}
      </div>
      <div className="jam-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-text-muted">
        {room.visibility === "public" ? (
          <Globe2 size={12} />
        ) : (
          <Lock size={12} />
        )}
        {room.visibility === "public"
          ? t("jam.room.publicRoom")
          : t("jam.visibility.inviteOnly")}
      </div>
      {room.is_permanent ? (
        <div className="jam-accent-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          <Pin size={12} />
          {t("jam.roomCard.permanent")}
        </div>
      ) : null}
    </div>
  );
}

function JamRoomConnectionBadges(props: JamRoomConnectionBadgesProps) {
  const { t, room, queueMode, isConnected, connectionProblem, roomIsActive } =
    props;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {isConnected ? (
        <div className="jam-success-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          <Radio size={12} className="jam-success-text" />
          {t("jam.room.connected")}
        </div>
      ) : (
        <div className="jam-warning-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          {connectionProblem && !connectionProblem.includes("Retrying") ? (
            <Radio size={12} />
          ) : (
            <Loader2 size={12} className="animate-spin" />
          )}
          {connectionProblem || t("jam.room.connecting")}
        </div>
      )}
      {!roomIsActive ? (
        <div className="jam-warning-chip inline-flex rounded-full px-3 py-1 text-xs font-medium">
          {t("jam.room.ended")}
        </div>
      ) : null}
      {queueMode === "auto_dj" && (room.genre_filters || []).length ? (
        <div className="jam-info-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          {t("jam.room.autoDjGenres", {
            genres: (room.genre_filters || []).join(", "),
          })}
        </div>
      ) : null}
      {(room.tags || []).map((tag) => (
        <div
          key={tag}
          className="jam-chip inline-flex rounded-full px-3 py-1 text-xs font-medium text-text-muted"
        >
          {tag}
        </div>
      ))}
    </div>
  );
}

function JamRoomIdentity(props: JamRoomIdentityProps) {
  const { t, room } = props;

  return (
    <div className="min-w-0">
      <div className="jam-accent-text text-xs uppercase tracking-wide">
        {t("jam.room.eyebrow")}
      </div>
      <JamRoomMetaBadges {...props} />
      <p className="mt-2 max-w-2xl text-sm text-text-muted">
        {room.description ||
          t("jam.room.defaultDescription", {
            count: room.members.length,
          })}
      </p>
      <JamRoomConnectionBadges {...props} />
    </div>
  );
}

function JamRoomHeaderActions(props: JamRoomHeaderActionsProps) {
  const {
    t,
    isConnected,
    roomIsActive,
    isHost,
    currentTrackAlreadyQueued,
    queuePrimaryActionLabel,
    shareCurrentTrack,
    handlePlayRoomQueue,
    queueItems,
    roomActionsOpen,
    setRoomActionsOpen,
  } = props;

  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      <HeroPrimaryButton
        label={queuePrimaryActionLabel}
        onClick={shareCurrentTrack}
        disabled={!roomIsActive || !isConnected || currentTrackAlreadyQueued}
        title={
          currentTrackAlreadyQueued
            ? t("jam.toasts.trackAlreadyInQueue")
            : undefined
        }
        className="jam-accent-chip"
      >
        <Plus size={17} />
      </HeroPrimaryButton>
      <HeroPrimaryButton
        label={t("jam.room.actions.playRoomQueue")}
        onClick={handlePlayRoomQueue}
        disabled={queueItems.length === 0 || !isHost || !isConnected}
      >
        <ListMusic size={17} />
      </HeroPrimaryButton>
      {isHost ? (
        <HeroActionButton
          label={t("jam.room.actions.roomSettings")}
          aria-expanded={roomActionsOpen}
          onClick={() => setRoomActionsOpen((open) => !open)}
          className={roomActionsOpen ? "jam-accent-chip" : ""}
        >
          <MoreHorizontal size={18} />
        </HeroActionButton>
      ) : null}
    </div>
  );
}

export function JamRoomHeader(props: JamRoomHeaderProps) {
  return (
    <>
      <JamRoomIdentity {...props} />
      <JamRoomHeaderActions {...props} />
    </>
  );
}
