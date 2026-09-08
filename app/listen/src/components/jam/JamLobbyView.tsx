import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { JamInvitePanel } from "@/components/jam/JamInvitePanel";
import { JamOpenRoomsPanel } from "@/components/jam/JamOpenRoomsPanel";
import { JamRoomCreatePanel } from "@/components/jam/JamRoomCreatePanel";
import type {
  JamOpenRoomsPanelProps,
  JamRoomCreatePanelProps,
} from "@/components/jam/jam-lobby-types";

export function JamLobbyView({
  roomName,
  setRoomName,
  roomDescription,
  setRoomDescription,
  roomTagsInput,
  setRoomTagsInput,
  roomQueueMode,
  onRoomQueueModeChange,
  roomGenreFiltersInput,
  setRoomGenreFiltersInput,
  genreSuggestionIndex,
  setGenreSuggestionIndex,
  selectedGenreItems,
  removeGenre,
  genreSuggestions,
  taxonomyLoading,
  selectGenre,
  roomAutoDjVoting,
  setRoomAutoDjVoting,
  roomVisibility,
  setRoomVisibility,
  roomPermanent,
  setRoomPermanent,
  creating,
  onCreateRoom,
  inviteInput,
  setInviteInput,
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
  deleteRoomModal,
}: JamLobbyViewProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-6">
        <div className="jam-lobby-header rounded-[12px] p-5 sm:p-6">
          <h1 className="text-3xl font-bold text-text-primary">
            {t("jam.lobby.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {t("jam.lobby.subtitle")}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
          <JamRoomCreatePanel
            roomName={roomName}
            setRoomName={setRoomName}
            roomDescription={roomDescription}
            setRoomDescription={setRoomDescription}
            roomTagsInput={roomTagsInput}
            setRoomTagsInput={setRoomTagsInput}
            roomQueueMode={roomQueueMode}
            onRoomQueueModeChange={onRoomQueueModeChange}
            roomGenreFiltersInput={roomGenreFiltersInput}
            setRoomGenreFiltersInput={setRoomGenreFiltersInput}
            genreSuggestionIndex={genreSuggestionIndex}
            setGenreSuggestionIndex={setGenreSuggestionIndex}
            selectedGenreItems={selectedGenreItems}
            removeGenre={removeGenre}
            genreSuggestions={genreSuggestions}
            taxonomyLoading={taxonomyLoading}
            selectGenre={selectGenre}
            roomAutoDjVoting={roomAutoDjVoting}
            setRoomAutoDjVoting={setRoomAutoDjVoting}
            roomVisibility={roomVisibility}
            setRoomVisibility={setRoomVisibility}
            roomPermanent={roomPermanent}
            setRoomPermanent={setRoomPermanent}
            creating={creating}
            onCreateRoom={onCreateRoom}
          />
          <JamOpenRoomsPanel
            roomsLoading={roomsLoading}
            roomSearch={roomSearch}
            setRoomSearch={setRoomSearch}
            memberRooms={memberRooms}
            publicRooms={publicRooms}
            user={user}
            joiningRoomId={joiningRoomId}
            deletingRoomId={deletingRoomId}
            onJoinRoom={onJoinRoom}
            onDeleteRoom={onDeleteRoom}
          />
        </div>

        <JamInvitePanel
          inviteInput={inviteInput}
          setInviteInput={setInviteInput}
        />
      </div>
      {deleteRoomModal}
    </>
  );
}

type JamLobbyViewProps = JamRoomCreatePanelProps &
  JamOpenRoomsPanelProps & {
    inviteInput: string;
    setInviteInput: (value: string) => void;
    deleteRoomModal: ReactNode;
  };
