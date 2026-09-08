import { Loader2, Search } from "@crate/ui/icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { AuthUser } from "@/contexts/auth-context";
import { JamRoomCard } from "@/components/jam/JamRoomCard";
import type { JamRoom } from "@/pages/jam-reducer";

import type { JamOpenRoomsPanelProps } from "./jam-lobby-types";

export function JamOpenRoomsPanel({
  roomsLoading,
  roomSearch,
  setRoomSearch,
  memberRooms,
  publicRooms,
  user,
  joiningRoomId,
  deletingRoomId,
  onJoinRoom,
  onDeleteRoom,
}: JamOpenRoomsPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="jam-panel rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.lobby.openRoomsTitle")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("jam.lobby.openRoomsSubtitle")}
          </p>
        </div>
        {roomsLoading ? (
          <Loader2 size={18} className="animate-spin text-accent-action" />
        ) : null}
      </div>

      <div className="jam-input mt-4 flex items-center gap-2 rounded-lg px-3 py-2">
        <Search size={15} className="text-text-muted" />
        <input
          value={roomSearch}
          onChange={(event) => setRoomSearch(event.target.value)}
          placeholder={t("jam.lobby.searchPlaceholder")}
          className="h-8 min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="mt-5 space-y-6">
        <RoomList
          rooms={memberRooms}
          title={t("jam.lobby.yourRooms")}
          emptyLabel={t("jam.lobby.emptyMemberRooms")}
          mode="member"
          roomsLoading={roomsLoading}
          user={user}
          joiningRoomId={joiningRoomId}
          deletingRoomId={deletingRoomId}
          onJoinRoom={onJoinRoom}
          onDeleteRoom={onDeleteRoom}
          t={t}
        />
        <RoomList
          rooms={publicRooms}
          title={t("jam.lobby.publicRooms")}
          emptyLabel={t("jam.lobby.emptyPublicRooms")}
          mode="public"
          roomsLoading={roomsLoading}
          user={user}
          joiningRoomId={joiningRoomId}
          deletingRoomId={deletingRoomId}
          onJoinRoom={onJoinRoom}
          onDeleteRoom={onDeleteRoom}
          t={t}
        />
      </div>
    </section>
  );
}

function RoomList({
  rooms,
  title,
  emptyLabel,
  mode,
  roomsLoading,
  user,
  joiningRoomId,
  deletingRoomId,
  onJoinRoom,
  onDeleteRoom,
  t,
}: {
  rooms: JamRoom[];
  title: string;
  emptyLabel: string;
  mode: "member" | "public";
  roomsLoading: boolean;
  user: AuthUser | null;
  joiningRoomId: string | null;
  deletingRoomId: string | null;
  onJoinRoom: (room: JamRoom) => void;
  onDeleteRoom: (room: JamRoom) => void;
  t: TFunction;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <span className="text-xs text-text-muted">{rooms.length}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rooms.map((room) => (
          <JamRoomCard
            key={room.id}
            listedRoom={room}
            mode={mode}
            user={user}
            joining={joiningRoomId === room.id}
            deleting={deletingRoomId === room.id}
            onJoin={onJoinRoom}
            onDelete={onDeleteRoom}
            t={t}
          />
        ))}
        {!roomsLoading && rooms.length === 0 ? (
          <div className="jam-empty-state rounded-lg p-5 text-sm text-text-muted">
            {emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}
