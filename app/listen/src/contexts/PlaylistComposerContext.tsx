import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { PlaylistCreateModal, type PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { api } from "@/lib/api";
import { hasTrackReference, toTrackReferencePayload } from "@/lib/track-reference";

interface OpenPlaylistComposerOptions {
  name?: string;
  description?: string;
  visibility?: "public" | "private";
  isCollaborative?: boolean;
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
  const [initialVisibility, setInitialVisibility] = useState<"public" | "private">("private");
  const [initialCollaborative, setInitialCollaborative] = useState(false);
  const [initialTracks, setInitialTracks] = useState<PlaylistComposerTrack[]>([]);

  const openCreatePlaylist = useCallback((options?: OpenPlaylistComposerOptions) => {
    setInitialName(options?.name ?? "");
    setInitialDescription(options?.description ?? "");
    setInitialVisibility(options?.visibility ?? "private");
    setInitialCollaborative(options?.isCollaborative ?? false);
    setInitialTracks(options?.tracks ?? []);
    setOpen(true);
  }, []);

  const handleSubmit = useCallback(async (payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) => {
    setSubmitting(true);
    try {
      const created = await api<{ id: number }>("/api/playlists", "POST", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
      });

      const tracksPayload = payload.tracks
        .filter((track) => hasTrackReference(track))
        .map((track) => toTrackReferencePayload({
          ...track,
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
  }, [navigate]);

  const handleClose = useCallback(() => {
    if (!submitting) setOpen(false);
  }, [submitting]);

  const contextValue = useMemo(
    () => ({ openCreatePlaylist }),
    [openCreatePlaylist],
  );

  return (
    <PlaylistComposerContext.Provider value={contextValue}>
      {children}
      <PlaylistCreateModal
        open={open}
        initialName={initialName}
        initialDescription={initialDescription}
        initialVisibility={initialVisibility}
        initialCollaborative={initialCollaborative}
        initialTracks={initialTracks}
        submitting={submitting}
        onClose={handleClose}
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
