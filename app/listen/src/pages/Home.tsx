import { CrateLoader } from "@/components/ui/CrateLoader";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { HomeContent } from "@/pages/HomeContent";
import { useHomePageController } from "@/pages/use-home-page-controller";

export function Home() {
  const page = useHomePageController();
  const view = page.view;

  if (!view) {
    if (page.discoveryLoading || !page.discoveryError) {
      return <CrateLoader label={page.t("home.loading")} />;
    }

    return (
      <ErrorState
        message={page.t("search.errors.tryAgain")}
        onRetry={() => {
          page.refetchDiscovery();
          void page.refreshLiveDiscovery(true);
        }}
      />
    );
  }

  return <HomeContent page={{ ...page, view }} />;
}
