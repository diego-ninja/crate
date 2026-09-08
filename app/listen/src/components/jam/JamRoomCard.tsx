import { Globe2, Loader2, Lock, Pin, Trash2, Users } from "@crate/ui/icons";
import type { TFunction } from "i18next";

import type { AuthUser } from "@/contexts/auth-context";
import { type JamRoom } from "@/pages/jam-reducer";
import {
  displayName,
  eventActivityText,
  resolveJamActor,
} from "@/pages/jam-session-utils";

import { JamAvatarBubble } from "./JamAvatarBubble";

export function JamRoomCard({
  listedRoom,
  mode,
  user,
  joining,
  deleting,
  onJoin,
  onDelete,
  t,
}: {
  listedRoom: JamRoom;
  mode: "member" | "public";
  user: AuthUser | null;
  joining: boolean;
  deleting: boolean;
  onJoin: (room: JamRoom) => void;
  onDelete: (room: JamRoom) => void;
  t: TFunction;
}) {
  const isMember =
    listedRoom.is_member ??
    listedRoom.members.some((member) => member.user_id === user?.id);
  const isHostRoom = listedRoom.host_user_id === user?.id;
  const latestEvent = [...(listedRoom.events || [])].reverse()[0];
  const latestActor = latestEvent
    ? resolveJamActor(latestEvent, listedRoom.members, user)
    : null;

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-label={
          isMember
            ? t("jam.roomCard.openAria", { name: listedRoom.name })
            : t("jam.roomCard.joinAria", { name: listedRoom.name })
        }
        onClick={() => onJoin(listedRoom)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onJoin(listedRoom);
          }
        }}
        className="jam-card-interactive cursor-pointer rounded-xl p-4"
      >
        <RoomCardHeader room={listedRoom} mode={mode} joining={joining} t={t} />
        <RoomCardMembers room={listedRoom} t={t} />
        {latestEvent ? (
          <div className="mt-3 truncate text-xs text-text-muted">
            {eventActivityText(latestEvent, latestActor?.name, t)}
          </div>
        ) : null}
      </div>
      {isHostRoom ? (
        <RoomCardDeleteButton
          room={listedRoom}
          deleting={deleting}
          onDelete={onDelete}
          t={t}
        />
      ) : null}
    </div>
  );
}

function RoomCardHeader({
  room,
  mode,
  joining,
  t,
}: {
  room: JamRoom;
  mode: "member" | "public";
  joining: boolean;
  t: TFunction;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-text-primary">
          {room.name}
        </div>
        {room.description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
            {room.description}
          </p>
        ) : null}
        <RoomCardBadges room={room} mode={mode} t={t} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 pr-12">
        <div className="jam-chip flex size-9 items-center justify-center rounded-full text-text-muted">
          {joining ? (
            <Loader2 size={15} className="jam-accent-text animate-spin" />
          ) : (
            <Users size={15} />
          )}
        </div>
      </div>
    </div>
  );
}

function RoomCardBadges({
  room,
  mode,
  t,
}: {
  room: JamRoom;
  mode: "member" | "public";
  t: TFunction;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
      <span className="jam-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-text-muted">
        {room.visibility === "public" ? (
          <Globe2 size={11} />
        ) : (
          <Lock size={11} />
        )}
        {mode === "member"
          ? t("jam.roomCard.yourRoom")
          : t("jam.visibility.public")}
      </span>
      {room.is_permanent ? (
        <span className="jam-accent-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
          <Pin size={11} />
          {t("jam.roomCard.permanent")}
        </span>
      ) : null}
      {room.status !== "active" ? (
        <span className="jam-warning-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5">
          {t("jam.roomCard.paused")}
        </span>
      ) : null}
      {(room.tags || []).slice(0, 5).map((tag) => (
        <span
          key={`${room.id}-${tag}`}
          className="jam-chip rounded-full px-2 py-0.5 text-text-muted"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function RoomCardMembers({ room, t }: { room: JamRoom; t: TFunction }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <div className="flex">
        {room.members.slice(0, 5).map((member, index) => (
          <JamAvatarBubble
            key={`${room.id}-${member.user_id}`}
            name={displayName(member)}
            avatar={member.avatar}
            userId={member.user_id}
            size="sm"
            className={index === 0 ? "" : "-ml-2"}
          />
        ))}
      </div>
      <div className="text-xs text-text-muted">
        {t("jam.roomCard.memberCount", {
          count: room.member_count || room.members.length,
        })}
      </div>
    </div>
  );
}

function RoomCardDeleteButton({
  room,
  deleting,
  onDelete,
  t,
}: {
  room: JamRoom;
  deleting: boolean;
  onDelete: (room: JamRoom) => void;
  t: TFunction;
}) {
  return (
    <button
      type="button"
      onClick={() => onDelete(room)}
      disabled={deleting}
      title={t("jam.delete.title")}
      aria-label={t("jam.delete.aria", { name: room.name })}
      className="jam-danger-control absolute right-4 top-4 z-10 inline-flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-50"
    >
      {deleting ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Trash2 size={14} />
      )}
    </button>
  );
}
