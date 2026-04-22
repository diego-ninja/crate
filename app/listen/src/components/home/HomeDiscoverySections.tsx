import { useEffect, useRef, useState } from "react";
import { Play, Sparkles, Radio, Disc3, UserRound, ChevronLeft, ChevronRight, Info } from "lucide-react";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import { MixArtwork } from "@/components/home/MixArtwork";
import { SectionHeader, SectionRail, useSectionRail } from "@/components/home/HomeSections";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeRadioStation,
  HomeRecentItem,
  HomeSectionId,
  HomeSuggestedAlbum,
} from "./home-model";

const numberFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function statValue(value: number): string {
  return numberFormatter.format(value || 0);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function mixArtistSummary(item: HomeGeneratedPlaylistSummary): string {
  const names = (item.artwork_artists || [])
    .map((artist) => artist.artist_name?.trim())
    .filter(Boolean) as string[];

  if (!names.length) return item.description;
  const [first = "", second = "", third = ""] = names;
  if (names.length === 1) return first;
  if (names.length === 2) return `${first}, ${second}`;
  if (names.length === 3) return `${first}, ${second}, ${third}`;
  return `${first}, ${second}, ${third} and more`;
}

function recentArtwork(item: HomeRecentItem): string | null {
  if (item.type === "playlist") {
    return null;
  }
  if (item.type === "artist") {
    return artistPhotoApiUrl({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    }) || null;
  }
  return albumCoverApiUrl({
    albumId: item.album_id,
    albumSlug: item.album_slug,
    artistName: item.artist_name,
    albumName: item.album_name,
  }) || null;
}

function radioArtwork(station: HomeRadioStation): string | null {
  if (station.type === "album") {
    return albumCoverApiUrl({
      albumId: station.album_id,
      albumSlug: station.album_slug,
      artistName: station.artist_name,
      albumName: station.album_name,
    }) || null;
  }
  return artistPhotoApiUrl({
    artistId: station.artist_id,
    artistSlug: station.artist_slug,
    artistName: station.artist_name,
  }) || null;
}

export function HomeTasteHero({
  heroes,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  onInfo,
}: {
  heroes: HomeHeroArtist[];
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  onInfo: (artist: HomeHeroArtist) => void;
}) {
  const [idx, setIdx] = useState(0);
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRef = useRef<{ x: number; t: number } | null>(null);
  const count = heroes.length;

  const go = (to: number) => setIdx(((to % count) + count) % count);

  // Autoplay
  useEffect(() => {
    if (count <= 1) return;
    autoRef.current = setInterval(() => setIdx((p) => (p + 1) % count), 8000);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [count]);

  const pause = () => { if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; } };
  const resume = () => {
    pause();
    if (count <= 1) return;
    autoRef.current = setInterval(() => setIdx((p) => (p + 1) % count), 8000);
  };

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    pause();
    const touch = e.touches[0];
    if (touch) touchRef.current = { x: touch.clientX, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    if (!start) { resume(); return; }
    const endTouch = e.changedTouches[0];
    if (!endTouch) { resume(); return; }
    const dx = endTouch.clientX - start.x;
    const dt = Date.now() - start.t;
    if (Math.abs(dx) > 40 && dt < 500) {
      go(idx + (dx < 0 ? 1 : -1));
    }
    touchRef.current = null;
    resume();
  };

  if (!count) return null;

  return (
    <div
      className="relative"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Stack all slides — only active one is visible */}
      {heroes.map((hero, i) => (
        <div
          key={hero.id}
          className={cn(
            "transition-opacity duration-500 ease-in-out",
            i === idx ? "relative z-10 opacity-100" : "pointer-events-none absolute inset-0 z-0 opacity-0",
          )}
          aria-hidden={i !== idx}
        >
          <HeroSlide
            hero={hero}
            following={isFollowing(hero.id)}
            onOpenArtist={() => onOpenArtist(hero)}
            onPlay={() => onPlay(hero)}
            onToggleFollow={() => onToggleFollow(hero)}
            onInfo={() => onInfo(hero)}
          />
        </div>
      ))}

      {/* Nav arrows */}
      {count > 1 && (
        <>
          <button
            onClick={() => { go(idx - 1); pause(); }}
            className="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/60 backdrop-blur-sm transition hover:bg-black/60 hover:text-white"
            aria-label="Previous"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => { go(idx + 1); pause(); }}
            className="absolute right-3 top-1/2 z-20 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/60 backdrop-blur-sm transition hover:bg-black/60 hover:text-white"
            aria-label="Next"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      {/* Dots */}
      {count > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
          {heroes.map((_, i) => (
            <button
              key={i}
              onClick={() => { setIdx(i); pause(); }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === idx ? "w-6 bg-primary" : "w-1.5 bg-white/25 hover:bg-white/40",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroSlide({
  hero,
  following,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  onInfo,
}: {
  hero: HomeHeroArtist;
  following: boolean;
  onOpenArtist: () => void;
  onPlay: () => void;
  onToggleFollow: () => void;
  onInfo: () => void;
}) {
  const backgroundUrl = artistBackgroundApiUrl({
    artistId: hero.id,
    artistSlug: hero.slug,
    artistName: hero.name,
  });
  const backgroundSrc = backgroundUrl
    ? `${backgroundUrl}${backgroundUrl.includes("?") ? "&" : "?"}v=home-hero-bg-v2`
    : undefined;
  const [bgLoaded, setBgLoaded] = useState(false);

  useEffect(() => {
    if (!backgroundSrc) return;
    const img = new Image();
    img.src = backgroundSrc;
    img.onload = () => setBgLoaded(true);
    img.onerror = () => setBgLoaded(false);
  }, [backgroundSrc]);

  const genres = (hero as any).genres as string[] | undefined;

  return (
    <section
      className="group relative w-full overflow-hidden rounded-[34px] border border-white/10"
      role="button"
      tabIndex={0}
      onClick={onOpenArtist}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenArtist(); } }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(6,10,14,0.98)_0%,rgba(10,16,22,0.96)_52%,rgba(4,9,13,0.98)_100%)]" />
      {bgLoaded && backgroundSrc ? (
        <img
          src={backgroundSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,0.92)_0%,rgba(5,7,11,0.75)_45%,rgba(5,7,11,0.32)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.26),transparent_42%)]" />

      {/* Fixed-height content area */}
      <div className="relative z-10 flex h-[240px] flex-col justify-between px-6 py-6 sm:h-[280px] sm:px-8 sm:py-8 lg:px-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
              <Sparkles size={12} />
              Recommended
            </div>
            {genres && genres.length > 0 && (
              <div className="flex gap-1.5">
                {genres.slice(0, 2).map((g) => (
                  <span key={g} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-white/50">{g}</span>
                ))}
              </div>
            )}
          </div>

          <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            {hero.name}
          </h1>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1">
              {statValue(hero.listeners)} listeners
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1">
              {hero.album_count} albums · {hero.track_count} tracks
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
          >
            <Play size={15} fill="currentColor" />
            Play
          </button>
          <button
            className={cn(
              "inline-flex items-center rounded-full border border-white/12 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]",
              following ? "text-primary" : "",
            )}
            onClick={(e) => { e.stopPropagation(); onToggleFollow(); }}
          >
            {following ? "Following" : "Follow"}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            onClick={(e) => { e.stopPropagation(); onInfo(); }}
          >
            <Info size={14} />
            About
          </button>
        </div>
      </div>
    </section>
  );
}

export function RecentEntityRow({
  item,
  onClick,
}: {
  item: HomeRecentItem;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);

  return (
    <button
      onClick={onClick}
      className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:bg-white/[0.06]"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5">
        {item.type === "playlist" ? (
          <PlaylistArtwork
            name={item.playlist_name}
            coverDataUrl={item.playlist_cover_data_url}
            tracks={item.playlist_tracks}
            className="h-full w-full rounded-xl"
          />
        ) : artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            {item.type === "artist" ? (
              <UserRound size={18} className="text-white/30" />
            ) : (
              <Disc3 size={18} className="text-white/30" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {item.type === "playlist"
            ? item.playlist_name
            : item.type === "artist"
              ? item.artist_name
              : item.album_name}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {item.type === "playlist"
            ? item.playlist_description || item.subtitle
            : item.type === "artist"
              ? item.subtitle
              : item.artist_name}
        </div>
      </div>

      <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {item.type}
      </div>
    </button>
  );
}

export function RecentlyPlayedSection({
  items,
  onOpenItem,
  onViewAll,
}: {
  items: HomeDiscoveryPayload["recently_played"];
  onOpenItem: (item: HomeRecentItem) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const pages = chunkItems(items, 9);
  const rail = useSectionRail(pages.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Recently played"
        subtitle="Albums, artists and playlists you touched most recently."
        actionLabel="View all"
        onAction={() => onViewAll("recently-played")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} className="gap-0">
        {pages.map((pageItems, pageIndex) => (
          <div key={`recent-page-${pageIndex}`} className="min-w-full snap-start">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item, index) => (
                <RecentEntityRow
                  key={`${item.type}-${pageIndex}-${index}`}
                  item={item}
                  onClick={() => onOpenItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function CustomMixesSection({
  mixes,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  onViewAll,
}: {
  mixes: HomeGeneratedPlaylistSummary[];
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const rail = useSectionRail(mixes.length);
  if (!mixes.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Custom mixes"
        subtitle="Dynamic playlists shaped around your own listening profile."
        actionLabel="View all"
        onAction={() => onViewAll("custom-mixes")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {mixes.map((mix) => (
          <CustomMixCard
            key={mix.id}
            item={mix}
            onOpenMix={onOpenMix}
            onPlayMix={onPlayMix}
            onShuffleMix={onShuffleMix}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CustomMixCard({
  item,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayMix(item),
    onShuffle: () => onShuffleMix(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenMix(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMix(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-3xl",
        layout === "grid" ? "w-full min-w-0" : "w-[180px] flex-shrink-0",
      )}
    >
      <div className="relative mb-2 overflow-hidden rounded-3xl bg-white/5">
        <MixArtwork item={item} className="aspect-square rounded-3xl transition-transform group-hover:scale-[1.02]" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <button
            className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayMix(item);
            }}
          >
            <Play size={18} fill="#0a0a0f" className="ml-0.5 text-primary-foreground" />
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
      <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
        {mixArtistSummary(item)}
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/40">{item.track_count} tracks</div>
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function SuggestedAlbumsSection({
  albums,
  onViewAll,
}: {
  albums: HomeSuggestedAlbum[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const rail = useSectionRail(albums.length);
  if (!albums.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Suggested new albums for you"
        subtitle="Recent releases from the artists you already care about."
        actionLabel="View all"
        onAction={() => onViewAll("suggested-albums")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {albums.map((album) => (
          <AlbumCard
            key={`${album.album_id ?? `${album.artist_name}-${album.album_name}`}`}
            artist={album.artist_name}
            album={album.album_name}
            albumId={album.album_id}
            albumSlug={album.album_slug}
            year={album.year}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function RecommendedTracksSection({
  tracks,
  onViewAll,
}: {
  tracks: TrackRowData[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const pages = chunkItems(tracks, 9);
  const rail = useSectionRail(pages.length);
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Recommended new tracks"
        subtitle="Fresh cuts from artists and albums that line up with your taste."
        actionLabel="View all"
        onAction={() => onViewAll("recommended-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {pages.map((pageTracks, pageIndex) => (
          <div key={`recommended-page-${pageIndex}`} className="min-w-full snap-start">
            <div className="grid gap-2 xl:grid-cols-3">
              {pageTracks.map((track, index) => (
                <TrackRow
                  key={`${track.library_track_id ?? track.path ?? track.title}-${pageIndex}-${index}`}
                  track={track}
                  showArtist
                  showAlbum
                  showCoverThumb
                  queueTracks={pageTracks}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function RadioStationCard({
  station,
  onPlay,
  layout = "rail",
}: {
  station: HomeRadioStation;
  onPlay: () => void;
  layout?: "rail" | "grid";
}) {
  const artworkUrl = radioArtwork(station);

  return (
    <button
      onClick={onPlay}
      className={cn(
        "group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] text-left",
        layout === "grid"
          ? "w-full min-w-0"
          : "w-[180px] flex-shrink-0 lg:w-[calc((100%-4rem)/5)] xl:w-[calc((100%-6rem)/7)]",
      )}
    >
      <div
        className="aspect-square bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.04]"
        style={{ backgroundImage: artworkUrl ? `url(${artworkUrl})` : undefined }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(6,8,12,0.92)_100%)]" />
      <div className="absolute left-3 top-3 rounded-full border border-primary/20 bg-primary/12 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
        <Radio size={11} className="inline-block" /> Station
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="truncate text-sm font-semibold text-white">{station.title}</div>
        <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/60">{station.subtitle}</div>
      </div>
    </button>
  );
}

export function RadioStationsSection({
  stations,
  onPlayStation,
  onViewAll,
}: {
  stations: HomeRadioStation[];
  onPlayStation: (station: HomeRadioStation) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const rail = useSectionRail(stations.length);
  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Radio stations"
        subtitle="Artist and album radios seeded from the things you replay the most."
        actionLabel="View all"
        onAction={() => onViewAll("radio-stations")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.type}-${station.artist_id ?? station.album_id ?? station.title}`}
            station={station}
            onPlay={() => onPlayStation(station)}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function FavoriteArtistsSection({
  artists,
  onViewAll,
}: {
  artists: HomeDiscoveryPayload["favorite_artists"];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const rail = useSectionRail(artists.length);
  if (!artists.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Favorite artists"
        subtitle="Your most played names over the last few months."
        actionLabel="View all"
        onAction={() => onViewAll("favorite-artists")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {artists.map((artist) => (
          <ArtistCard
            key={artist.artist_id ?? artist.artist_name}
            name={artist.artist_name}
            artistId={artist.artist_id}
            artistSlug={artist.artist_slug}
            subtitle={`${artist.play_count} plays`}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CoreTracksPlaylistCard({
  item,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayPlaylist(item),
    onShuffle: () => onShufflePlaylist(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPlaylist(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPlaylist(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-3xl",
        layout === "grid"
          ? "w-full min-w-0"
          : "w-[180px] flex-shrink-0 lg:w-[calc((100%-4rem)/5)] xl:w-[calc((100%-6rem)/7)]",
      )}
    >
      <div className="relative mb-2 overflow-hidden rounded-3xl bg-white/5">
        <CoreTracksArtwork item={item} className="aspect-square rounded-3xl transition-transform group-hover:scale-[1.02]" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <button
            className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayPlaylist(item);
            }}
          >
            <Play size={18} fill="#0a0a0f" className="ml-0.5 text-primary-foreground" />
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
        Core Tracks
      </div>
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function EssentialsSection({
  items,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  onViewAll,
}: {
  items: HomeGeneratedPlaylistSummary[];
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const rail = useSectionRail(items.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Core tracks"
        subtitle="Artist-focused sets built from the names most present in your listening."
        actionLabel="View all"
        onAction={() => onViewAll("core-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {items.map((item) => (
          <CoreTracksPlaylistCard
            key={item.id}
            item={item}
            onOpenPlaylist={onOpenPlaylist}
            onPlayPlaylist={onPlayPlaylist}
            onShufflePlaylist={onShufflePlaylist}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function openRecentItemPath(item: HomeRecentItem): string {
  if (item.type === "playlist") {
    return item.playlist_scope === "system"
      ? `/curation/playlist/${item.playlist_id}`
      : `/playlist/${item.playlist_id}`;
  }
  if (item.type === "artist") {
    return artistPagePath({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    });
  }
  return albumPagePath({
    albumId: item.album_id,
    albumSlug: item.album_slug,
    artistName: item.artist_name,
    albumName: item.album_name,
  });
}
