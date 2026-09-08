import { type ChangeEvent, type Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Upload } from "@crate/ui/icons";

import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import type {
  PlaylistComposerAction,
  PlaylistComposerState,
} from "@/components/playlists/playlist-composer-model";
import { cn } from "@/lib/utils";

type PlaylistIdentityState = Pick<
  PlaylistComposerState,
  | "name"
  | "description"
  | "coverDataUrl"
  | "visibility"
  | "isCollaborative"
  | "tracks"
  | "titleEditing"
  | "descriptionEditing"
>;

export function PlaylistIdentitySection({
  state,
  refs,
  dispatch,
  handleFileChange,
  t,
}: {
  state: PlaylistIdentityState;
  refs: {
    fileInputRef: { current: HTMLInputElement | null };
    titleInputRef: { current: HTMLInputElement | null };
    descriptionInputRef: { current: HTMLTextAreaElement | null };
  };
  dispatch: Dispatch<PlaylistComposerAction>;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const {
    name,
    description,
    coverDataUrl,
    visibility,
    isCollaborative,
    tracks,
    titleEditing,
    descriptionEditing,
  } = state;
  const { fileInputRef, titleInputRef, descriptionInputRef } = refs;

  return (
    <div className="flex items-start gap-4">
      <div className="relative shrink-0">
        <PlaylistArtwork
          name={name || t("playlistComposer.newPlaylist")}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="size-24 rounded-xl shadow-2xl sm:size-28"
        />
        <button
          type="button"
          className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1 rounded-full bg-surface-canvas/65 px-2.5 py-1.5 text-xs font-medium text-text-primary backdrop-blur-md transition-colors hover:bg-surface-canvas/80"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={12} />
          {t("playlistComposer.editCover")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-text-primary/40">
            {t("playlistComposer.playlistLabel")}
          </div>
          {titleEditing ? (
            <input
              ref={titleInputRef}
              type="text"
              placeholder={t("playlistComposer.namePlaceholder")}
              value={name}
              onChange={(event) =>
                dispatch({ type: "set-name", value: event.target.value })
              }
              onBlur={() =>
                dispatch({ type: "set-title-editing", value: false })
              }
              className="w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 py-2.5 text-xl font-semibold text-text-primary placeholder:text-text-muted focus:border-accent-action focus:outline-none"
            />
          ) : (
            <button
              type="button"
              className="w-full text-left text-xl font-semibold text-text-primary transition-colors hover:text-text-primary"
              onClick={() =>
                dispatch({ type: "set-title-editing", value: true })
              }
            >
              {name || t("playlistComposer.addTitle")}
            </button>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-text-primary/40">
            {t("playlistComposer.descriptionLabel")}
          </div>
          {descriptionEditing ? (
            <textarea
              ref={descriptionInputRef}
              rows={3}
              placeholder={t("playlistComposer.descriptionPlaceholder")}
              value={description}
              onChange={(event) =>
                dispatch({
                  type: "set-description",
                  value: event.target.value,
                })
              }
              onBlur={() =>
                dispatch({
                  type: "set-description-editing",
                  value: false,
                })
              }
              className="w-full resize-none rounded-lg border border-border-quiet bg-text-primary/5 px-3 py-2.5 text-base text-text-primary placeholder:text-text-muted focus:border-accent-action focus:outline-none"
            />
          ) : (
            <button
              type="button"
              className="w-full text-left text-sm leading-6 text-text-muted transition-colors hover:text-text-primary"
              onClick={() =>
                dispatch({
                  type: "set-description-editing",
                  value: true,
                })
              }
            >
              {description || t("playlistComposer.addDescription")}
            </button>
          )}
        </div>

        {coverDataUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border-quiet px-3 py-2 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            onClick={() => dispatch({ type: "set-cover", value: null })}
          >
            <ImagePlus size={14} />
            Use collage instead
          </button>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              visibility === "private"
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() =>
              dispatch({ type: "set-visibility", value: "private" })
            }
          >
            Private
          </button>
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              visibility === "public"
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() =>
              dispatch({ type: "set-visibility", value: "public" })
            }
          >
            Public
          </button>
          <button
            type="button"
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isCollaborative
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() => dispatch({ type: "toggle-collaborative" })}
          >
            Collaborative
          </button>
        </div>
      </div>
    </div>
  );
}
