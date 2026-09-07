import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { Disc3, Sparkles, UserRound } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ContextMenuHeader,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";

import type { HomeRecentItem } from "./home-model";
import {
  openRecentItemPath,
  recentArtwork,
  recentPlaylistArtwork,
  recentSubtitle,
  recentTitle,
} from "./home-recent-entities-model";

export function RecentEntityRow({
  item,
  onClick,
}: {
  item: HomeRecentItem;
  onClick: () => void;
}) {
  if (item.type === "album") {
    return <RecentAlbumEntityRow item={item} onClick={onClick} />;
  }
  if (item.type === "artist") {
    return <RecentArtistEntityRow item={item} onClick={onClick} />;
  }
  return <RecentPlaylistEntityRow item={item} onClick={onClick} />;
}

function RecentAlbumEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "album" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useAlbumActionEntries({
    artist: item.artist_name,
    artistSlug: item.artist_slug,
    artistEntityUid: item.artist_entity_uid,
    album: item.album_name,
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    albumSlug: item.album_slug,
    cover: artworkUrl ?? undefined,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.album_name,
        subtitle: item.artist_name,
        imageUrl: artworkUrl,
        imageAlt: item.album_name,
        imageShape: "square",
        fallbackIcon: Disc3,
      }}
      onClick={onClick}
    />
  );
}

function RecentArtistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "artist" }>;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const actions = useArtistActionEntries({
    artistId: item.artist_id,
    artistEntityUid: item.artist_entity_uid,
    globalArtistUid: item.global_artist_uid,
    artistSlug: item.artist_slug,
    imageUrl: artworkUrl,
    name: item.artist_name,
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.artist_name,
        subtitle: item.subtitle,
        imageUrl: artworkUrl,
        imageAlt: item.artist_name,
        imageShape: "circle",
        fallbackIcon: UserRound,
      }}
      onClick={onClick}
    />
  );
}

function RecentPlaylistEntityRow({
  item,
  onClick,
}: {
  item: Extract<HomeRecentItem, { type: "playlist" }>;
  onClick: () => void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId: item.playlist_id,
    name: item.playlist_name,
    isSmart: item.playlist_scope === "system",
    href: openRecentItemPath(item),
  });

  return (
    <RecentEntityRowFrame
      item={item}
      actions={actions}
      header={{
        type: "media",
        title: item.playlist_name,
        subtitle: item.playlist_description || item.subtitle,
        imageUrl: recentPlaylistArtwork(item),
        imageAlt: item.playlist_name,
        imageShape: "square",
        fallbackIcon: Sparkles,
      }}
      onClick={onClick}
    />
  );
}

function RecentEntityRowFrame({
  item,
  actions,
  header,
  onClick,
}: {
  item: HomeRecentItem;
  actions: ItemActionMenuEntry[];
  header: ContextMenuHeader;
  onClick: () => void;
}) {
  const artworkUrl = recentArtwork(item);
  const title = recentTitle(item);
  const subtitle = recentSubtitle(item);
  const actionMenu = useItemActionMenu(actions);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    actionMenu.handleKeyboardTrigger(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-discovery-card group flex min-w-0 items-center gap-3 rounded-lg p-3 text-left"
      {...actionMenu.longPressHandlers}
    >
      <div className="home-discovery-artwork relative size-12 shrink-0 overflow-hidden rounded-xl">
        {item.type === "playlist" ? (
          <PlaylistArtwork
            name={item.playlist_name}
            coverDataUrl={item.playlist_cover_data_url}
            tracks={item.playlist_tracks}
            className=" size-full rounded-xl"
          />
        ) : artworkUrl ? (
          <CrateImage
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className=" size-full object-cover"
          />
        ) : (
          <div className="home-discovery-artwork flex size-full items-center justify-center">
            {item.type === "artist" ? (
              <UserRound
                size={18}
                className="home-discovery-placeholder-icon"
              />
            ) : (
              <Disc3 size={18} className="home-discovery-placeholder-icon" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 truncate text-xs text-text-muted">
            {subtitle}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className=" size-9 opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        />
      </div>

      <ItemActionMenu
        actions={actions}
        header={header}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
