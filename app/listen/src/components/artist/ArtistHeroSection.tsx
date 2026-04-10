import { useRef, useState } from "react";
import {
  ChevronDown,
  ListMusic,
  MoreHorizontal,
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
import { AppMenuButton } from "@/components/ui/AppPopover";
import { AppModal, ModalBody } from "@/components/ui/AppModal";
import { useIsDesktop } from "@/hooks/use-breakpoint";
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
  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bio = artistInfo?.bio ?? "";

  return (
    <>
      <div className="relative h-[420px] overflow-hidden sm:h-[400px]">
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-40 blur-[6px]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/78 to-background/35" />

        <div className="relative flex h-full items-end px-4 pb-6 sm:px-6">
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
            {/* Avatar — small inline on mobile, large circle on desktop */}
            <div className="hidden sm:block h-40 w-40 flex-shrink-0 overflow-hidden rounded-full bg-white/5 shadow-2xl ring-2 ring-white/10">
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
              <div className="flex items-center gap-3 sm:block">
                <div className="sm:hidden h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-white/5 shadow-xl ring-2 ring-white/10">
                  <img
                    src={photoUrl}
                    alt={artist.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <h1 className="mb-1 text-2xl font-bold text-foreground sm:mb-2 sm:text-4xl">{artist.name}</h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:hidden">
                    {artistInfo?.listeners ? (
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {formatCompact(artistInfo.listeners)}
                      </span>
                    ) : null}
                    {artist.total_tracks > 0 ? <span>{artist.total_tracks} tracks</span> : null}
                    {artist.albums.length > 0 ? <span>{artist.albums.length} albums</span> : null}
                  </div>
                </div>
              </div>

              <div className="hidden sm:flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
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

      <div className="flex items-center gap-2 px-4 py-4 sm:px-6">
        <button
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={onPlay}
          aria-label="Play"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-foreground transition-colors hover:bg-white/5"
          onClick={onShuffle}
          aria-label="Shuffle"
        >
          <Shuffle size={16} />
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-foreground transition-colors hover:bg-white/5"
          onClick={onArtistRadio}
          aria-label="Artist Radio"
        >
          <Radio size={16} />
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-foreground transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onPlaySetlist}
          disabled={!hasSetlist}
          aria-label="Setlist"
        >
          <ListMusic size={16} />
        </button>
        <button
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
            following
              ? "border border-primary/30 bg-primary/15 text-primary"
              : "border border-white/15 text-foreground hover:bg-white/5"
          }`}
          onClick={onToggleFollow}
          aria-label={following ? "Unfollow" : "Follow"}
        >
          {following ? <UserCheck size={16} /> : <UserPlus size={16} />}
        </button>
        <div className="relative" ref={menuRef}>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/50 transition-colors hover:bg-white/5 hover:text-foreground"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="More"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && !isDesktop && (
            <AppModal open={menuOpen} onClose={() => setMenuOpen(false)} maxWidthClassName="sm:max-w-sm">
              <ModalBody className="pb-4">
                <ArtistMenuContent
                  artist={artist}
                  photoUrl={photoUrl}
                  following={following}
                  hasSetlist={hasSetlist}
                  onPlay={() => { onPlay(); setMenuOpen(false); }}
                  onShuffle={() => { onShuffle(); setMenuOpen(false); }}
                  onArtistRadio={() => { onArtistRadio(); setMenuOpen(false); }}
                  onPlaySetlist={onPlaySetlist ? () => { onPlaySetlist(); setMenuOpen(false); } : undefined}
                  onToggleFollow={() => { onToggleFollow(); setMenuOpen(false); }}
                  onShare={() => { onShare(); setMenuOpen(false); }}
                />
              </ModalBody>
            </AppModal>
          )}
        </div>
      </div>
    </>
  );
}

function ArtistMenuContent({
  artist, photoUrl, following, hasSetlist,
  onPlay, onShuffle, onArtistRadio, onPlaySetlist, onToggleFollow, onShare,
}: {
  artist: ArtistData;
  photoUrl: string;
  following: boolean;
  hasSetlist?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
          <img src={photoUrl} alt={artist.name} className="w-full h-full object-cover" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{artist.name}</div>
          <div className="text-xs text-muted-foreground">{artist.total_tracks} tracks · {artist.albums.length} albums</div>
        </div>
      </div>
      <div className="p-1.5">
        <AppMenuButton onClick={onPlay}>
          <Play size={15} /> Play top tracks
        </AppMenuButton>
        <AppMenuButton onClick={onShuffle}>
          <Shuffle size={15} /> Shuffle
        </AppMenuButton>
        <AppMenuButton onClick={onArtistRadio}>
          <Radio size={15} /> Artist radio
        </AppMenuButton>
        {onPlaySetlist ? (
          <AppMenuButton onClick={onPlaySetlist} disabled={!hasSetlist}>
            <ListMusic size={15} /> Play setlist
          </AppMenuButton>
        ) : null}
        <AppMenuButton onClick={onToggleFollow}>
          {following ? <UserCheck size={15} /> : <UserPlus size={15} />}
          {following ? "Unfollow" : "Follow"}
        </AppMenuButton>
        <AppMenuButton onClick={onShare}>
          <Share2 size={15} /> Share
        </AppMenuButton>
      </div>
    </>
  );
}
