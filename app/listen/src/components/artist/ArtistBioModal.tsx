import { useNavigate } from "react-router";

import { artistGenreSlug, type ArtistData, type ArtistInfo } from "@/components/artist/artist-model";
import { AppModal, ModalBody, ModalCloseButton, ModalHeader } from "@/components/ui/AppModal";
import { formatCompact } from "@/lib/utils";

interface ArtistBioModalProps {
  open: boolean;
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  tags: string[];
  onClose: () => void;
}

export function ArtistBioModal({
  open,
  artist,
  artistInfo,
  photoUrl,
  tags,
  onClose,
}: ArtistBioModalProps) {
  const navigate = useNavigate();
  const bio = artistInfo?.bio ?? "";

  return (
    <AppModal open={open} onClose={onClose} maxWidthClassName="sm:max-w-2xl">
      <ModalHeader>
        <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-white/5 shadow-xl">
              <img
                src={photoUrl}
                alt={artist.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground sm:text-2xl">{artist.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {artistInfo?.listeners ? <span>{formatCompact(artistInfo.listeners)} listeners</span> : null}
                {artistInfo?.playcount ? <span>{formatCompact(artistInfo.playcount)} scrobbles</span> : null}
              </div>
              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/12 hover:text-white"
                      onClick={() => {
                        navigate(`/explore?genre=${encodeURIComponent(artistGenreSlug(tag))}`);
                        onClose();
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <ModalCloseButton
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
          />
        </div>
      </ModalHeader>

      <ModalBody className="max-h-[calc(92vh-124px)] px-5 py-5 sm:px-6">
        <p className="whitespace-pre-line text-sm leading-7 text-white/78 sm:text-[15px]">
          {bio}
        </p>
      </ModalBody>
    </AppModal>
  );
}
