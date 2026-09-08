import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";

import type { GenreDetail } from "./explore-model";
import { buildRelatedGenreImageCandidates } from "./genre-covers";

export type RelatedGenre = NonNullable<GenreDetail["related_genres"]>[number];

interface RelatedGenreCardProps {
  genre: RelatedGenre;
  onOpen: () => void;
}

export function RelatedGenreCard({ genre, onOpen }: RelatedGenreCardProps) {
  const { t } = useTranslation();
  const imageCandidates = useMemo(
    () => buildRelatedGenreImageCandidates(genre),
    [genre],
  );
  const imageFingerprint = imageCandidates.join("|");
  const [imageState, setImageState] = useState({
    fingerprint: imageFingerprint,
    index: 0,
  });
  const imageIndex =
    imageState.fingerprint === imageFingerprint ? imageState.index : 0;
  const coverUrl = imageCandidates[imageIndex] ?? null;
  const contentLabel = [
    genre.artist_count > 0
      ? t("common.artistCountLabel", { count: genre.artist_count })
      : null,
    genre.album_count > 0
      ? t("common.albumCountLabel", { count: genre.album_count })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="explore-related-genre-card group relative isolate min-h-[132px] overflow-hidden rounded-lg p-3 text-left transition-[border-color,filter,transform] hover:-translate-y-px"
    >
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          className="absolute inset-0 -z-10 size-full scale-[1.04] object-cover opacity-35 saturate-125 transition duration-300 group-hover:opacity-45"
          decoding="async"
          loading="eager"
          onError={() => {
            setImageState((previous) => {
              const currentIndex =
                previous.fingerprint === imageFingerprint ? previous.index : 0;
              return {
                fingerprint: imageFingerprint,
                index:
                  currentIndex + 1 < imageCandidates.length
                    ? currentIndex + 1
                    : imageCandidates.length,
              };
            });
          }}
        />
      ) : null}
      <div className="explore-related-genre-overlay absolute inset-0 -z-10" />
      <div className="flex h-full min-h-[108px] flex-col justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-action/85">
            {genre.relation_label}
          </div>
          <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-text-primary">
            {genre.name}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-muted">
            {contentLabel}
          </span>
          <ArrowRight
            size={14}
            className="shrink-0 text-text-primary/35 transition group-hover:translate-x-0.5 group-hover:text-accent-action"
          />
        </div>
      </div>
    </button>
  );
}
