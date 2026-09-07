import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, Send } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

import type { useArtistSuggestionController } from "./use-artist-suggestion-controller";

type ArtistSuggestionController = ReturnType<
  typeof useArtistSuggestionController
>;

export function ArtistSuggestionModal({
  controller,
}: {
  controller: ArtistSuggestionController;
}) {
  const { t } = useTranslation();
  if (!controller.open || typeof document === "undefined") return null;

  return createPortal(
    <AppModal
      open={controller.open}
      onClose={controller.closeModal}
      maxWidthClassName="sm:max-w-md"
    >
      <form onSubmit={controller.submit}>
        <ModalHeader className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-action">
                {t("userMenu.suggest.badge")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-text-primary">
                {t("userMenu.suggest.title")}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {t("userMenu.suggest.description")}
              </p>
            </div>
            <ModalCloseButton
              onClick={controller.closeModal}
              disabled={controller.sending}
            />
          </div>
        </ModalHeader>
        <ModalBody className="space-y-4 p-5 ">
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.artistLabel")}
            </span>
            <input
              value={controller.artist}
              onChange={(event) => controller.setArtist(event.target.value)}
              placeholder="High Vis, Denzel Curry, ..."
              aria-invalid={controller.error ? true : undefined}
              aria-describedby={
                controller.error ? "artist-suggestion-error" : undefined
              }
              className="h-11 w-full rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 text-base text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              required
              minLength={2}
              maxLength={200}
            />
            {controller.error ? (
              <span
                id="artist-suggestion-error"
                className="block text-xs text-state-danger-text"
              >
                {controller.error}
              </span>
            ) : null}
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.linkLabel")}
            </span>
            <input
              value={controller.url}
              onChange={(event) => controller.setUrl(event.target.value)}
              placeholder="Bandcamp, Tidal, Spotify, YouTube…"
              className="h-11 w-full rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 text-base text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              maxLength={500}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.noteLabel")}
            </span>
            <textarea
              value={controller.note}
              onChange={(event) => controller.setNote(event.target.value)}
              placeholder={t("userMenu.suggest.notePlaceholder")}
              className="min-h-24 w-full resize-none rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 py-2 text-base text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              maxLength={1000}
            />
          </label>
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={controller.closeModal}
            className="rounded-lg border border-border-quiet px-4 py-2 text-sm text-text-primary/65 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            disabled={controller.sending}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={controller.sending || controller.artistName.length < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2 text-sm font-semibold text-accent-action-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={CRATE_ICON_SIZE.sm} />
            {controller.sending
              ? t("userMenu.suggest.sending")
              : t("userMenu.suggest.submit")}
          </button>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
}
