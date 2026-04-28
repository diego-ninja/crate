import { useCallback, useMemo, useState } from "react";

import { useApi } from "@/hooks/use-api";

export interface PlaylistOption {
  id: number;
  name: string;
}

export function useLazyPlaylistOptions(initiallyEnabled = false) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const { data } = useApi<PlaylistOption[]>(enabled ? "/api/playlists" : null);

  const ensurePlaylistOptionsLoaded = useCallback(() => {
    setEnabled(true);
  }, []);

  const playlistOptions = useMemo(
    () => (data ?? []).map((playlist) => ({ id: playlist.id, name: playlist.name })),
    [data],
  );

  return {
    playlistOptions,
    ensurePlaylistOptionsLoaded,
  };
}
