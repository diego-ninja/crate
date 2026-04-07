import {
  ChevronDown,
  ListMusic,
  Play,
  Radio,
  Share2,
  Shuffle,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router";

import { artistGenreSlug, type ArtistData, type ArtistInfo } from "@/components/artist/artist-model";
import { formatCompact } from "@/lib/utils";

interface ArtistHeroSectionProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  tags: string[];
  following: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  hasSetlist?: boolean;
  onToggleFollow: () => void;
  onShare: () => void;
  onOpenBio: () => void;
}

export function ArtistHeroSection({
  artist,
  artistInfo,
  photoUrl,
  tags,
  following,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  hasSetlist,
  onToggleFollow,
  onShare,
  onOpenBio,
}: ArtistHeroSectionProps) {
  const navigate = useNavigate();
  const bio = artistInfo?.bio ?? "";

  return (
    <>
      <div className="relative h-[340px] overflow-hidden sm:h-[400px]">
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-30 blur-md"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/78 to-background/35" />

        <div className="relative flex h-full items-end px-4 pb-6 sm:px-6">
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
            <div className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-full bg-white/5 shadow-2xl ring-2 ring-white/10 sm:h-40 sm:w-40">
              <img
                src={photoUrl}
                alt={artist.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>

            <div className="max-w-3xl pb-1">
              <h1 className="mb-2 text-3xl font-bold text-foreground sm:text-4xl">{artist.name}</h1>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {artistInfo?.listeners ? (
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {formatCompact(artistInfo.listeners)} listeners
                  </span>
                ) : null}
                {artist.total_tracks > 0 ? <span>{artist.total_tracks} tracks</span> : null}
                {artist.albums.length > 0 ? <span>{artist.albums.length} albums</span> : null}
              </div>

              {bio ? (
                <div className="mt-3 max-w-2xl">
                  <p className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-white/70">
                    {bio}
                  </p>
                  {bio.length > 200 ? (
                    <button
                      className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={onOpenBio}
                    >
                      Show more <ChevronDown size={12} />
                    </button>
                  ) : null}
                </div>
              ) : null}

              {tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.slice(0, 8).map((tag) => (
                    <button
                      key={tag}
                      className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/12 hover:text-white"
                      onClick={() => navigate(`/explore?genre=${encodeURIComponent(artistGenreSlug(tag))}`)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        <button
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={onPlay}
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5"
          onClick={onShuffle}
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5"
          onClick={onArtistRadio}
        >
          <Radio size={15} />
          Artist Radio
        </button>
        <button
          className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onPlaySetlist}
          disabled={!hasSetlist}
        >
          <ListMusic size={15} />
          Setlist
        </button>
        <button
          className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm transition-colors ${
            following
              ? "border border-primary/30 bg-primary/15 text-primary"
              : "border border-white/15 text-foreground hover:bg-white/5"
          }`}
          onClick={onToggleFollow}
        >
          {following ? <UserCheck size={15} /> : <UserPlus size={15} />}
          {following ? "Following" : "Follow"}
        </button>
        <button
          className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5"
          onClick={onShare}
        >
          <Share2 size={15} />
          Share
        </button>
      </div>
    </>
  );
}
