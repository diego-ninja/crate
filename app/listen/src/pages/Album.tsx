import { useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Clock, Disc, Heart, ListPlus, MoreHorizontal, Play, Radio, Share2, Shuffle, User } from "lucide-react";
import { toast } from "sonner";

import { AppMenuButton, AppPopover, AppPopoverDivider } from "@/components/ui/AppPopover";
import { useApi } from "@/hooks/use-api";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { api } from "@/lib/api";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { fetchAlbumRadio } from "@/lib/radio";
import { formatBadgeClass, shuffleArray, formatTotalDuration } from "@/lib/utils";
import { albumApiPath, albumCoverApiUrl, albumPagePath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface AlbumTrack {
  id: number;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  length_sec: number;
  rating: number;
  tags: {
    title: string;
    artist: string;
    album: string;
    albumartist: string;
    tracknumber: string;
    discnumber: string;
    date: string;
    genre: string;
    musicbrainz_albumid: string;
    musicbrainz_trackid: string;
  };
  path: string;
}

interface AlbumData {
  id: number;
  slug?: string;
  artist_id?: number;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  tracks: AlbumTrack[];
  album_tags: {
    artist: string;
    album: string;
    year: string;
    genre: string;
    musicbrainz_albumid: string | null;
  };
  genres: string[];
}

interface Playlist {
  id: number;
  name: string;
}


function buildPlayerTracks(data: AlbumData): Track[] {
  const cover = albumCoverApiUrl({ albumId: data.id, albumSlug: data.slug, artistName: data.artist, albumName: data.name });
  return data.tracks.map((t) => ({
    id: t.path || String(t.id),
      title: t.tags.title || t.filename,
      artist: data.artist,
      artistId: data.artist_id,
      artistSlug: data.artist_slug,
      album: data.display_name || data.name,
      albumId: data.id,
      albumSlug: data.slug,
      albumCover: cover,
      path: t.path,
      libraryTrackId: t.id,
  }));
}


export function Album() {
  const { albumId: albumIdParam } = useParams<{ albumId?: string }>();
  const navigate = useNavigate();
  const { playAll, playNext } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const { isSaved, saveAlbum, unsaveAlbum } = useSavedAlbums();
  const [menuOpen, setMenuOpen] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const routeAlbumId = albumIdParam ? Number(albumIdParam) : undefined;

  const { data, loading, error } = useApi<AlbumData>(
    routeAlbumId != null ? albumApiPath({ albumId: routeAlbumId }) : null,
  );
  const { data: playlists } = useApi<Playlist[]>("/api/playlists");

  useDismissibleLayer({
    active: menuOpen || playlistPickerOpen,
    refs: [menuRef],
    onDismiss: () => {
      setMenuOpen(false);
      setPlaylistPickerOpen(false);
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Album not found</p>
      </div>
    );
  }

  const coverUrl = albumCoverApiUrl({ albumId: data.id, albumSlug: data.slug, artistName: data.artist, albumName: data.name });
  const artistPhotoUrl = artistPhotoApiUrl({ artistId: data.artist_id, artistSlug: data.artist_slug, artistName: data.artist });
  const displayName = data.display_name || data.name;
  const albumId = data.id;
  const artistName = data.artist;
  const albumTracks = data.tracks;
  const year = data.album_tags?.year?.slice(0, 4);
  const genre = data.genres.length > 0 ? data.genres.join(", ") : data.album_tags?.genre;
  const playerTracks = buildPlayerTracks(data);
  const saved = isSaved(albumId);

  const formats = [...new Set(albumTracks.map((t) => t.format).filter(Boolean))];
  const hasMultipleDiscs = albumTracks.some(
    (t) => t.tags.discnumber && parseInt(t.tags.discnumber) > 1,
  );

  const handlePlay = (startIndex = 0) => {
    if (playerTracks.length > 0) {
      playAll(playerTracks, startIndex, {
        type: "album",
        name: `${artistName} — ${displayName}`,
        radio: {
          seedType: "album",
          seedId: albumId,
        },
      });
    }
  };

  const handleShuffle = () => {
    if (playerTracks.length === 0) return;
    const shuffled = shuffleArray(playerTracks);
    playAll(shuffled, 0, {
      type: "album",
      name: `${artistName} — ${displayName}`,
      radio: {
        seedType: "album",
        seedId: albumId,
      },
    });
  };

  async function handleAlbumRadio() {
    try {
      const radio = await fetchAlbumRadio({
        albumId,
        artistName,
        albumName: displayName,
      });
      if (!radio.tracks.length) {
        toast.info("Album radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start album radio");
    }
  }

  const handlePlayNextAlbum = () => {
    [...playerTracks].reverse().forEach((track) => playNext(track));
    toast.success("Album queued to play next");
    setMenuOpen(false);
  };

  const shareUrl = `${window.location.origin}${albumPagePath({ albumId, albumSlug: data.slug })}`;

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${artistName} - ${displayName}`, text: `${artistName} - ${displayName}`, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Album link copied");
      }
    } catch {
      toast.error("Failed to share album");
    }
  }

  async function handleToggleSaved() {
    try {
      if (saved) {
        await unsaveAlbum(albumId);
        toast.success("Removed from your collection");
      } else {
        await saveAlbum(albumId);
        toast.success("Added to your collection");
      }
    } catch {
      toast.error("Failed to update collection");
    }
  }

  const playlistTracksPayload = albumTracks.map((track) => ({
    path: track.path,
    title: track.tags.title || track.filename,
    artist: artistName,
    album: displayName,
    duration: track.length_sec,
  }));

  async function handleAddToPlaylist(playlistId: number) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", { tracks: playlistTracksPayload });
      toast.success("Album added to playlist");
      setMenuOpen(false);
      setPlaylistPickerOpen(false);
    } catch {
      toast.error("Failed to add album to playlist");
    }
  }

  async function handleAddTrackToPlaylist(playlistId: number, track: TrackRowData) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [{
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album || displayName,
          duration: track.duration || 0,
        }],
      });
      toast.success(`Added "${track.title}" to playlist`);
    } catch {
      toast.error("Failed to add track to playlist");
    }
  }

  function handleCreatePlaylistFromAlbum() {
    openCreatePlaylist({
      name: displayName,
      tracks: albumTracks.map((track) => ({
        title: track.tags.title || track.filename,
        artist: artistName,
        album: displayName,
        duration: track.length_sec,
        path: track.path,
        libraryTrackId: track.id,
      })),
    });
    setMenuOpen(false);
    setPlaylistPickerOpen(false);
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: [{
        title: track.title,
        artist: track.artist,
        album: track.album || displayName,
        duration: track.duration,
        path: track.path,
        libraryTrackId: track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined),
        navidromeId: track.navidrome_id,
      }],
    });
  }

  // Group tracks by disc if multi-disc
  const tracksByDisc = new Map<number, AlbumTrack[]>();
  for (const t of data.tracks) {
    const disc = parseInt(t.tags.discnumber) || 1;
    if (!tracksByDisc.has(disc)) tracksByDisc.set(disc, []);
    tracksByDisc.get(disc)!.push(t);
  }

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      {/* Header */}
      <div className="px-4 sm:px-6 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 5rem)" }}>
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Cover */}
          <div className="flex-shrink-0 w-[200px] sm:w-[240px] lg:w-[280px] mx-auto sm:mx-0">
            <div className="aspect-square rounded-lg overflow-hidden bg-white/5 shadow-2xl">
              {data.has_cover ? (
                <img
                  src={coverUrl}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Disc size={64} className="text-white/10" />
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col justify-end text-left">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1.5">{displayName}</h1>
            <button
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-3 self-start"
              onClick={() => navigate(artistPagePath({ artistId: data.artist_id, artistSlug: data.artist_slug }))}
            >
              <span className="w-6 h-6 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
                <img
                  src={artistPhotoUrl}
                  alt={data.artist}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </span>
              {data.artist}
            </button>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground justify-center sm:justify-start">
              {year && <span>{year}</span>}
              {genre && <span>{genre}</span>}
              {data.track_count > 0 && (
                <span>{data.track_count} tracks</span>
              )}
              {data.total_length_sec > 0 && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {formatTotalDuration(data.total_length_sec)}
                </span>
              )}
              {formats.map((f) => (
                <span key={f} className={`${formatBadgeClass(f)} text-[11px] px-2.5 py-0.5`}>{f}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-2 px-4 sm:px-6 pb-4">
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          onClick={() => handlePlay()}
          aria-label="Play"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-foreground transition-colors hover:bg-white/5"
          onClick={handleShuffle}
          aria-label="Shuffle"
        >
          <Shuffle size={16} />
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-foreground transition-colors hover:bg-white/5"
          onClick={handleAlbumRadio}
          aria-label="Album Radio"
        >
          <Radio size={16} />
        </button>
        <button
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
            saved
              ? "border border-primary/30 bg-primary/15 text-primary"
              : "border border-white/15 text-foreground hover:bg-white/5"
          }`}
          onClick={handleToggleSaved}
          aria-label={saved ? "Remove from collection" : "Add to collection"}
        >
          <Heart size={16} className={saved ? "fill-current" : ""} />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/50 transition-colors hover:bg-white/5 hover:text-foreground"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="More"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <AppPopover className="absolute top-full left-0 mt-2 w-72 overflow-hidden rounded-2xl">
              <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {data.has_cover ? (
                    <img src={coverUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Disc size={20} className="text-white/20" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">{data.artist}</div>
                </div>
              </div>

              <div className="p-1.5">
                <AppMenuButton
                  onClick={() => {
                    handlePlay();
                    setMenuOpen(false);
                  }}
                >
                  <Play size={15} />
                  Play now
                </AppMenuButton>
                <AppMenuButton
                  onClick={handlePlayNextAlbum}
                >
                  <ListPlus size={15} />
                  Play next
                </AppMenuButton>
                <AppMenuButton
                  className="justify-between"
                  onClick={() => setPlaylistPickerOpen((open) => !open)}
                >
                  <span className="flex items-center gap-3">
                    <ListPlus size={15} />
                    Add to playlist
                  </span>
                  <span className="text-white/35">{playlistPickerOpen ? "−" : "+"}</span>
                </AppMenuButton>
                {playlistPickerOpen && (
                  <div className="px-3 pb-2 space-y-1">
                    <button
                      className="w-full text-left rounded-lg px-3 py-2 text-sm text-foreground hover:bg-white/5 transition-colors"
                      onClick={handleCreatePlaylistFromAlbum}
                    >
                      Add new playlist
                    </button>
                    {playlists && playlists.length > 0 ? (
                      <AppPopoverDivider className="mx-1" />
                    ) : null}
                    {playlists && playlists.length > 0 ? (
                      playlists.map((playlist) => (
                        <button
                          key={playlist.id}
                          className="w-full text-left rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                          onClick={() => handleAddToPlaylist(playlist.id)}
                        >
                          {playlist.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No playlists yet</div>
                    )}
                  </div>
                )}
                <AppMenuButton
                  onClick={async () => {
                    await handleToggleSaved();
                    setMenuOpen(false);
                  }}
                >
                  <Heart size={15} className={saved ? "fill-current text-primary" : ""} />
                  {saved ? "Remove from my collection" : "Add to my collection"}
                </AppMenuButton>
                <AppMenuButton
                  onClick={() => {
                    navigate(artistPagePath({ artistId: data.artist_id, artistSlug: data.artist_slug }));
                    setMenuOpen(false);
                  }}
                >
                  <User size={15} />
                  Go to artist
                </AppMenuButton>
                <AppMenuButton
                  onClick={async () => {
                    await handleShare();
                    setMenuOpen(false);
                  }}
                >
                  <Share2 size={15} />
                  Share
                </AppMenuButton>
              </div>
            </AppPopover>
          )}
        </div>
      </div>

      {/* Track List */}
      <div className="px-4 sm:px-6 pb-8">
        {hasMultipleDiscs ? (
          [...tracksByDisc.entries()]
            .sort(([a], [b]) => a - b)
            .map(([disc, tracks]) => (
              <div key={disc} className="mb-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Disc size={12} />
                  Disc {disc}
                </div>
                {tracks.map((t, idx) => (
                  <TrackRow
                    key={t.id}
                    track={{
                      id: String(t.id),
                      title: t.tags.title || t.filename,
                      artist: data.artist,
                      artist_id: data.artist_id,
                      artist_slug: data.artist_slug,
                      album: displayName,
                      album_id: data.id,
                      album_slug: data.slug,
                      duration: t.length_sec,
                      path: t.path,
                      track_number: parseInt(t.tags.tracknumber) || idx + 1,
                      format: t.format,
                      navidrome_id: undefined,
                      library_track_id: t.id,
                    }}
                    index={parseInt(t.tags.tracknumber) || idx + 1}
                    albumCover={coverUrl}
                    playlistOptions={playlists ?? undefined}
                    onAddToPlaylist={handleAddTrackToPlaylist}
                    onCreatePlaylist={handleCreatePlaylistFromTrack}
                  />
                ))}
              </div>
            ))
        ) : (
          data.tracks.map((t, idx) => (
            <TrackRow
              key={t.id}
                track={{
                  id: String(t.id),
                  title: t.tags.title || t.filename,
                  artist: data.artist,
                  artist_id: data.artist_id,
                  artist_slug: data.artist_slug,
                  album: displayName,
                  album_id: data.id,
                  album_slug: data.slug,
                  duration: t.length_sec,
                path: t.path,
                track_number: parseInt(t.tags.tracknumber) || idx + 1,
                format: t.format,
                navidrome_id: undefined,
                library_track_id: t.id,
              }}
              index={parseInt(t.tags.tracknumber) || idx + 1}
              albumCover={coverUrl}
              playlistOptions={playlists ?? undefined}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={handleCreatePlaylistFromTrack}
            />
          ))
        )}
      </div>
    </div>
  );
}
