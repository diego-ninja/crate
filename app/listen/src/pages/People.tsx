import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PeopleContent } from "@/pages/PeopleContent";
import type { SocialSummary } from "@/pages/people-types";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { usePeopleSearch } from "@/pages/use-people-search";

export function People() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading } = useApi<SocialSummary>("/api/me/social");
  const [query, setQuery] = useState("");
  const { results, searching } = usePeopleSearch(query);

  return (
    <PeopleContent
      data={data}
      loading={loading}
      onQueryChange={setQuery}
      query={query}
      results={results}
      searching={searching}
      t={t}
      user={user}
    />
  );
}
