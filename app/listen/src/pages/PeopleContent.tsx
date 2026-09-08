import { Loader2 } from "@crate/ui/icons";

import type { AuthUser } from "@/contexts/auth-context";
import { PeopleSearch } from "@/pages/PeopleSearch";
import { PeopleSummary } from "@/pages/PeopleSummary";
import type { SocialSummary, UserSearchResult } from "@/pages/people-types";
import type { TFunction } from "i18next";

export function PeopleContent({
  data,
  loading,
  onQueryChange,
  query,
  results,
  searching,
  t,
  user,
}: {
  data: SocialSummary | null | undefined;
  loading: boolean;
  onQueryChange: (value: string) => void;
  query: string;
  results: UserSearchResult[];
  searching: boolean;
  t: TFunction;
  user: AuthUser | null;
}) {
  return (
    <div className="space-y-6">
      <PeopleSummary data={data} t={t} user={user} />
      <PeopleSearch
        onQueryChange={onQueryChange}
        query={query}
        results={results}
        searching={searching}
        t={t}
      />
      {loading ? (
        <div className="flex items-center justify-center py-6 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : null}
    </div>
  );
}
