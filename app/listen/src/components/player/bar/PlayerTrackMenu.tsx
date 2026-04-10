import { useRef, useState, type RefObject } from "react";
import {
  ArrowLeft,
  Disc,
  ListMusic,
  MoreHorizontal,
  Plus,
  Share2,
  User,
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";

import { currentTrackToPlaylistSeed } from "./player-bar-utils";
import { AppMenuButton, AppPopover } from "@/components/ui/AppPopover";

interface PlaylistOption {
  id: number;
  name: string;
}

interface PlayerTrackMenuProps {
  currentTrack: Track;
  duration: number;
  onOverlayChange: (open: boolean) => void;
  onAddToCollection: () => Promise<void>;
}

export function PlayerTrackMenu({
  currentTrack,
  duration,
  onOverlayChange,
  onAddToCollection,
}: PlayerTrackMenuProps) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { openCreatePlaylist } = usePlaylistComposer();
  const { data: playlists } = useApi<PlaylistOption[]>("/api/playlists");

  const closeMenu = () => {
    setShowMenu(false);
    setShowPlaylistPicker(false);
    onOverlayChange(false);
  };

  useDismissibleLayer({
    active: showMenu,
    refs: [menuRef, menuButtonRef] as RefObject<HTMLElement>[],
    onDismiss: closeMenu,
    closeOnEscape: false,
  });

  async function handleAddCurrentTrackToPlaylist(playlistId: number) {
    if (!currentTrack.path) {
      toast.error("This track cannot be added to a playlist yet");
      return;
    }
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [{
          path: currentTrack.path,
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album || "",
          duration: duration || 0,
        }],
      });
      toast.success("Added to playlist");
      closeMenu();
    } catch {
      toast.error("Failed to add track to playlist");
    }
  }

  return (
    <div className="relative">
      <button
        ref={menuButtonRef}
        onClick={() => {
          const nextOpen = !showMenu;
          setShowPlaylistPicker(false);
          setShowMenu(nextOpen);
          onOverlayChange(nextOpen);
        }}
        aria-label="Track menu"
        className="shrink-0 rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
      >
        <MoreHorizontal size={16} />
      </button>

      {showMenu ? (
        <AppPopover ref={menuRef} className="absolute bottom-full left-0 mb-2 w-52 py-1.5">
          {showPlaylistPicker ? (
            <>
              <AppMenuButton
                onClick={() => setShowPlaylistPicker(false)}
                className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
              >
                <ArrowLeft size={14} className="shrink-0 text-white/40" />
                Back
              </AppMenuButton>
              <div className="mx-3 my-1 h-px bg-white/10" />
              <AppMenuButton
                onClick={() => {
                  openCreatePlaylist({
                    tracks: [currentTrackToPlaylistSeed(currentTrack, duration)],
                  });
                  closeMenu();
                }}
                className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
              >
                <Plus size={14} className="shrink-0 text-white/40" />
                Add new playlist
              </AppMenuButton>
              <div className="mx-3 my-1 h-px bg-white/10" />
              {playlists?.length ? (
                playlists.map((playlist) => (
                  <AppMenuButton
                    key={playlist.id}
                    onClick={() => void handleAddCurrentTrackToPlaylist(playlist.id)}
                    className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
                  >
                    <ListMusic size={14} className="shrink-0 text-white/40" />
                    {playlist.name}
                  </AppMenuButton>
                ))
              ) : (
                <div className="px-4 py-2 text-[12px] text-white/45">No playlists yet</div>
              )}
            </>
          ) : (
            [
              { icon: Plus, label: "Add to playlist", action: () => setShowPlaylistPicker(true) },
              {
                icon: Disc,
                label: "Add to my collection",
                action: () => {
                  void onAddToCollection();
                  closeMenu();
                },
              },
              {
                icon: User,
                label: "Go to artist",
                action: () => {
                  if (currentTrack.artistId != null) {
                    navigate(artistPagePath({ artistId: currentTrack.artistId, artistSlug: currentTrack.artistSlug }));
                  }
                  closeMenu();
                },
              },
              {
                icon: Disc,
                label: "Go to album",
                action: () => {
                  if (currentTrack.albumId != null) {
                    navigate(albumPagePath({ albumId: currentTrack.albumId, albumSlug: currentTrack.albumSlug }));
                  }
                  closeMenu();
                },
              },
              {
                icon: Share2,
                label: "Share",
                action: () => {
                  navigator.clipboard
                    .writeText(`${currentTrack.title} - ${currentTrack.artist}`)
                    .then(() => toast.success("Copied to clipboard"))
                    .catch(() => {});
                  closeMenu();
                },
              },
            ].map(({ icon: Icon, label, action }) => (
              <AppMenuButton
                key={label}
                onClick={action}
                className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
              >
                <Icon size={14} className="shrink-0 text-white/40" />
                {label}
              </AppMenuButton>
            ))
          )}
        </AppPopover>
      ) : null}
    </div>
  );
}
