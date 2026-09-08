import { ShowsContent } from "@/pages/ShowsContent";
import { useShowsPageController } from "@/pages/use-shows-page-controller";

export function Shows() {
  const page = useShowsPageController();

  return <ShowsContent page={page} />;
}
