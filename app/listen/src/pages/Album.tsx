import { Navigate } from "react-router";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { AlbumContent } from "@/pages/AlbumContent";
import { useAlbumPageController } from "@/pages/use-album-page-controller";

export function Album() {
  const page = useAlbumPageController();

  if (page.loading) {
    return <CrateLoader label={page.t("album.loading")} />;
  }

  if (page.error || !page.data) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">{page.t("album.notFound")}</p>
      </div>
    );
  }

  if (page.canonicalPath && page.locationPath !== page.canonicalPath) {
    return <Navigate to={page.canonicalPath} replace />;
  }

  const data = page.data;
  return <AlbumContent page={{ ...page, data }} />;
}
