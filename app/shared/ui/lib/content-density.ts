import type { ContentDensity } from "./appearance-types";

export interface ContentDensityMetrics {
  cardGap: string;
  cardPadding: string;
  gridGap: string;
  listGap: string;
  railGap: string;
  rowGap: string;
  rowInlineGap: string;
  rowPaddingY: string;
  rowEstimate: number;
}

export const CONTENT_DENSITY_METRICS: Record<
  ContentDensity,
  ContentDensityMetrics
> = {
  comfortable: {
    cardGap: "0.5rem",
    cardPadding: "0.5rem",
    gridGap: "1rem",
    listGap: "0.25rem",
    railGap: "1rem",
    rowGap: "0.75rem",
    rowInlineGap: "0.5rem",
    rowPaddingY: "0.625rem",
    rowEstimate: 72,
  },
  compact: {
    cardGap: "0.25rem",
    cardPadding: "0.25rem",
    gridGap: "0.75rem",
    listGap: "0.125rem",
    railGap: "0.75rem",
    rowGap: "0.5rem",
    rowInlineGap: "0.375rem",
    rowPaddingY: "0.375rem",
    rowEstimate: 64,
  },
};
