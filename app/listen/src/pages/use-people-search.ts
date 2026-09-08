import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { UserSearchResult } from "@/pages/people-types";

export function usePeopleSearch(query: string) {
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    api<UserSearchResult[]>(
      `/api/users/search?q=${encodeURIComponent(trimmed)}&limit=12`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((items) => setResults(items || []))
      .catch(() => {
        if (!controller.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });

    return () => controller.abort();
  }, [query]);

  return { results, searching };
}
