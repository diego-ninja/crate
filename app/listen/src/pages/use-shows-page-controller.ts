import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { useApi } from "@/hooks/use-api";
import {
  buildShowsPageModel,
  type ShowsFilter,
  type ShowsPageModel,
} from "@/pages/shows-page-model";
import type {
  GenreShowsResponse,
  UpcomingResponse,
} from "@/pages/shows-page-types";

export interface ShowsPageController extends ShowsPageModel {
  expandedId: string | null;
  focusShowId: string | null;
  genreName: string | undefined;
  genreSlug: string | null;
  search: string;
  setExpandedId: (id: string | null) => void;
  setFilter: (filter: ShowsFilter) => void;
  setSearch: (search: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
  filter: ShowsFilter;
}

export function useShowsPageController(): ShowsPageController {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const focusShowId = searchParams.get("show");
  const [filter, setFilter] = useState<ShowsFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, loading: upcomingLoading } = useApi<UpcomingResponse>(
    genreSlug ? null : "/api/me/upcoming",
  );
  const { data: genreData, loading: genreLoading } = useApi<GenreShowsResponse>(
    genreSlug ? `/api/genres/${genreSlug}?view=genre-detail-v5` : null,
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const model = useMemo(
    () =>
      buildShowsPageModel({
        data,
        filter,
        focusShowId,
        genreData,
        genreLoading,
        genreSlug,
        search,
        today,
        upcomingLoading,
      }),
    [
      data,
      filter,
      focusShowId,
      genreData,
      genreLoading,
      genreSlug,
      search,
      today,
      upcomingLoading,
    ],
  );

  return {
    ...model,
    expandedId,
    filter,
    focusShowId,
    genreName: genreData?.name,
    genreSlug,
    search,
    setExpandedId,
    setFilter,
    setSearch,
    t,
  };
}
