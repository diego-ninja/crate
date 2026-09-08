import { useSyncExternalStore } from "react";
import { subscribeThemeSkin } from "@crate/ui/lib/theme-skin";
import { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";
import type { ContentDensity } from "@crate/ui/lib/appearance-types";

export { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";

export function getContentDensity(): ContentDensity {
  if (typeof document === "undefined") return "comfortable";
  return document.documentElement.dataset.crateDensity === "compact"
    ? "compact"
    : "comfortable";
}

export function useContentDensity(): ContentDensity {
  return useSyncExternalStore(
    subscribeThemeSkin,
    getContentDensity,
    () => "comfortable" as const,
  );
}

export function getContentDensityMetrics() {
  return CONTENT_DENSITY_METRICS[getContentDensity()];
}
