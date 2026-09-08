import { Navigate } from "react-router";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { ArtistContent } from "@/pages/ArtistContent";
import { useArtistPageController } from "@/pages/use-artist-page-controller";
import { Button } from "@crate/ui/shadcn/button";

export function Artist() {
  const page = useArtistPageController();

  if (page.loading) {
    return <CrateLoader label={page.t("artist.loading")} />;
  }

  if (page.status === 404) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">{page.t("artist.notFound")}</p>
      </div>
    );
  }

  if (page.error) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-text-muted">{page.t("artist.unavailable")}</p>
        <Button className="rounded-lg" variant="outline" onClick={page.refetch}>
          {page.t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!page.page) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">{page.t("artist.notFound")}</p>
      </div>
    );
  }

  if (page.canonicalPath && page.locationPath !== page.canonicalPath) {
    return <Navigate to={page.canonicalPath} replace />;
  }

  return <ArtistContent page={{ ...page, page: page.page }} />;
}
