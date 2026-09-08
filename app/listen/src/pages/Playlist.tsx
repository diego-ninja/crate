import { CrateLoader } from "@/components/ui/CrateLoader";
import { PlaylistContent } from "@/pages/PlaylistContent";
import { useAuth } from "@/contexts/AuthContext";
import { usePlaylistPageController } from "@/pages/use-playlist-page-controller";

export function Playlist() {
  const page = usePlaylistPageController();
  const { user } = useAuth();

  if (page.loading) {
    return <CrateLoader label={page.t("playlist.loading")} />;
  }

  if (!page.data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-text-muted">{page.t("playlist.notFound")}</p>
      </div>
    );
  }

  return <PlaylistContent page={{ ...page, data: page.data }} user={user} />;
}
