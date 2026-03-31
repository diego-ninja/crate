import { createContext, useContext, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { PlaylistCreateModal, type PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { api } from "@/lib/api";

interface OpenPlaylistComposerOptions {
  name?: string;
  description?: string;
  tracks?: PlaylistComposerTrack[];
}

interface PlaylistComposerContextValue {
  openCreatePlaylist: (options?: OpenPlaylistComposerOptions) => void;
}

const PlaylistComposerContext = createContext<PlaylistComposerContextValue | undefined>(undefined);

export function PlaylistComposerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialName, setInitialName] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const [initialTracks, setInitialTracks] = useState<PlaylistComposerTrack[]>([]);

  function openCreatePlaylist(options?: OpenPlaylistComposerOptions) {
    setInitialName(options?.name ?? "");
    setInitialDescription(options?.description ?? "");
    setInitialTracks(options?.tracks ?? []);
    setOpen(true);
  }

  async function handleSubmit(payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    tracks: PlaylistComposerTrack[];
  }) {
    setSubmitting(true);
    try {
      const created = await api<{ id: number }>("/api/playlists", "POST", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
      });

      const tracksPayload = payload.tracks
        .filter((track) => track.path)
        .map((track) => ({
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          duration: track.duration || 0,
        }));

      if (tracksPayload.length > 0) {
        await api(`/api/playlists/${created.id}/tracks`, "POST", { tracks: tracksPayload });
      }

      setOpen(false);
      toast.success("Playlist created");
      navigate(`/playlist/${created.id}`);
    } catch {
      toast.error("Failed to create playlist");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PlaylistComposerContext.Provider value={{ openCreatePlaylist }}>
      {children}
      <PlaylistCreateModal
        open={open}
        initialName={initialName}
        initialDescription={initialDescription}
        initialTracks={initialTracks}
        submitting={submitting}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        onSubmit={handleSubmit}
      />
    </PlaylistComposerContext.Provider>
  );
}

export function usePlaylistComposer() {
  const value = useContext(PlaylistComposerContext);
  if (!value) {
    throw new Error("usePlaylistComposer must be used within PlaylistComposerProvider");
  }
  return value;
}
