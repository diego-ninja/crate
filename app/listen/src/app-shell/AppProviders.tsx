import type { ReactNode } from "react";

import { ArtistFollowsProvider } from "@/contexts/ArtistFollowsContext";
import { LikedTracksProvider } from "@/contexts/LikedTracksContext";
import { OfflineProvider } from "@/contexts/OfflineContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlaylistComposerProvider } from "@/contexts/PlaylistComposerContext";
import { SavedAlbumsProvider } from "@/contexts/SavedAlbumsContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <ArtistFollowsProvider>
        <LikedTracksProvider>
          <OfflineProvider>
            <SavedAlbumsProvider>
              <PlaylistComposerProvider>{children}</PlaylistComposerProvider>
            </SavedAlbumsProvider>
          </OfflineProvider>
        </LikedTracksProvider>
      </ArtistFollowsProvider>
    </PlayerProvider>
  );
}
