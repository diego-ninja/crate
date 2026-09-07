import { Search } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";

import type { JamRoomCreatePanelProps } from "./jam-lobby-types";

export function AutoDjOptions({
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
}: Pick<
  JamRoomCreatePanelProps,
  | "roomGenreFiltersInput"
  | "setRoomGenreFiltersInput"
  | "genreSuggestionIndex"
  | "setGenreSuggestionIndex"
  | "selectedGenreItems"
  | "removeGenre"
  | "genreSuggestions"
  | "taxonomyLoading"
  | "selectGenre"
  | "roomAutoDjVoting"
  | "setRoomAutoDjVoting"
>) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-2">
        <div className="relative">
          <div className="jam-tag-input flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5">
            {selectedGenreItems.map((item) => (
              <GenrePill
                key={item.slug}
                item={item}
                onRemove={() => removeGenre(item.slug || "")}
                removeLabel={t("jam.lobby.removeGenreFilter", {
                  genre: item.name,
                })}
              />
            ))}
            <Search size={16} className="ml-1 shrink-0 text-text-muted" />
            <input
              role="combobox"
              aria-label={t("jam.lobby.genreFiltersPlaceholder")}
              aria-expanded={Boolean(roomGenreFiltersInput.trim())}
              aria-controls="jam-genre-taxonomy-options"
              aria-autocomplete="list"
              value={roomGenreFiltersInput}
              onChange={(event) => {
                setRoomGenreFiltersInput(event.target.value);
                setGenreSuggestionIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && genreSuggestions.length) {
                  event.preventDefault();
                  setGenreSuggestionIndex(
                    (current) => (current + 1) % genreSuggestions.length,
                  );
                } else if (event.key === "ArrowUp" && genreSuggestions.length) {
                  event.preventDefault();
                  setGenreSuggestionIndex(
                    (current) =>
                      (current - 1 + genreSuggestions.length) %
                      genreSuggestions.length,
                  );
                } else if (
                  event.key === "Enter" &&
                  genreSuggestions[genreSuggestionIndex]
                ) {
                  if (event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  selectGenre(genreSuggestions[genreSuggestionIndex]);
                } else if (event.key === "Escape") {
                  setRoomGenreFiltersInput("");
                }
              }}
              placeholder={t("jam.lobby.genreFiltersPlaceholder")}
              className="h-8 min-w-[12rem] flex-1 bg-transparent px-1 text-base text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          {roomGenreFiltersInput.trim() ? (
            <GenreTaxonomyOptions
              genreSuggestions={genreSuggestions}
              taxonomyLoading={taxonomyLoading}
              genreSuggestionIndex={genreSuggestionIndex}
              selectGenre={selectGenre}
            />
          ) : null}
        </div>
        <p className="text-xs text-text-muted">
          {t("jam.lobby.genreFiltersHint")}
        </p>
      </div>
      <label className="jam-toggle-card flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-text-primary">
        <span>{t("jam.lobby.autoDjVoting")}</span>
        <input
          type="checkbox"
          checked={roomAutoDjVoting}
          onChange={(event) => setRoomAutoDjVoting(event.target.checked)}
          className=" size-4 accent-[var(--accent-action)]"
        />
      </label>
    </>
  );
}

function GenreTaxonomyOptions({
  genreSuggestions,
  taxonomyLoading,
  genreSuggestionIndex,
  selectGenre,
}: Pick<
  JamRoomCreatePanelProps,
  | "genreSuggestions"
  | "taxonomyLoading"
  | "genreSuggestionIndex"
  | "selectGenre"
>) {
  const { t } = useTranslation();

  return (
    <div
      id="jam-genre-taxonomy-options"
      role="listbox"
      className="jam-taxonomy-options absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg p-1 shadow-2xl"
    >
      {taxonomyLoading ? (
        <div className="px-3 py-2 text-xs text-text-muted">
          {t("jam.lobby.genreFiltersLoading")}
        </div>
      ) : genreSuggestions.length ? (
        genreSuggestions.map((node, index) => (
          <button
            key={node.slug}
            type="button"
            role="option"
            aria-selected={index === genreSuggestionIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectGenre(node)}
            className="jam-taxonomy-option flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors"
            data-active={index === genreSuggestionIndex ? "true" : "false"}
          >
            <span className="truncate">{node.name}</span>
            <span className="ml-3 shrink-0 text-xs text-text-muted">
              {node.slug}
            </span>
          </button>
        ))
      ) : (
        <div role="status" className="px-3 py-2 text-xs text-text-muted">
          {t("jam.lobby.genreFiltersNoResults")}
        </div>
      )}
    </div>
  );
}
