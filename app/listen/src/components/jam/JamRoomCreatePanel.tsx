import { Loader2, Pin, Radio } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { Button } from "@crate/ui/shadcn/button";

import {
  PlaybackModeSelect,
  RoomVisibilityOptions,
} from "./JamRoomCreateOptions";
import { AutoDjOptions } from "./JamRoomAutoDjOptions";
import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

export function JamRoomCreatePanel({
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
}: JamRoomCreatePanelProps) {
  const { t } = useTranslation();

  return (
    <section className="jam-panel rounded-[12px] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.lobby.startTitle")}
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        {t("jam.lobby.startSubtitle")}
      </p>
      <div className="mt-4 space-y-3">
        <input
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          placeholder={t("jam.lobby.namePlaceholder")}
          className="jam-input h-11 w-full rounded-lg px-4 text-base text-text-primary"
        />
        <textarea
          value={roomDescription}
          onChange={(event) => setRoomDescription(event.target.value)}
          placeholder={t("jam.lobby.descriptionPlaceholder")}
          rows={3}
          className="jam-input w-full resize-none rounded-lg px-4 py-3 text-base text-text-primary placeholder:text-text-muted"
        />
        <input
          value={roomTagsInput}
          onChange={(event) => setRoomTagsInput(event.target.value)}
          placeholder={t("jam.lobby.tagsPlaceholder")}
          className="jam-input h-11 w-full rounded-lg px-4 text-base text-text-primary placeholder:text-text-muted"
        />
        <PlaybackModeSelect
          roomQueueMode={roomQueueMode}
          onRoomQueueModeChange={onRoomQueueModeChange}
          setRoomPermanent={setRoomPermanent}
        />
        {roomQueueMode === "auto_dj" ? (
          <AutoDjOptions
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
          />
        ) : null}
        <RoomVisibilityOptions
          roomVisibility={roomVisibility}
          setRoomVisibility={setRoomVisibility}
        />
        <label className="jam-toggle-option flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
          <span className="inline-flex items-center gap-2">
            <Pin size={15} className="jam-accent-text" />
            {t("jam.lobby.permanentRoom")}
          </span>
          <input
            type="checkbox"
            checked={roomPermanent}
            onChange={(event) => setRoomPermanent(event.target.checked)}
            className=" size-4 accent-[var(--accent-action)]"
          />
        </label>
        <Button
          type="button"
          onClick={onCreateRoom}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-60"
        >
          {creating ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Radio size={15} />
          )}
          {t("jam.lobby.createRoom")}
        </Button>
      </div>
    </section>
  );
}
