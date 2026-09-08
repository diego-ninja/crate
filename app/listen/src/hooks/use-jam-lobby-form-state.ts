import { useCallback, useState } from "react";

import type { GenreTaxonomyNode } from "@/hooks/use-jam-lobby-data";
import type { JamQueueMode } from "@/pages/jam-reducer";

export function useJamLobbyFormState() {
  const [roomQueueMode, setRoomQueueMode] = useState<JamQueueMode>("manual");
  const [roomGenreFiltersInput, setRoomGenreFiltersInput] = useState("");
  const [roomGenreFilters, setRoomGenreFilters] = useState<string[]>([]);
  const [genreSuggestionIndex, setGenreSuggestionIndex] = useState(0);
  const [roomAutoDjVoting, setRoomAutoDjVoting] = useState(true);

  const selectGenre = useCallback((node: GenreTaxonomyNode) => {
    setRoomGenreFilters((current) =>
      current.includes(node.slug) ? current : [...current, node.slug],
    );
    setRoomGenreFiltersInput("");
    setGenreSuggestionIndex(0);
  }, []);

  const removeGenre = useCallback((slug: string) => {
    setRoomGenreFilters((current) => current.filter((value) => value !== slug));
  }, []);

  return {
    roomQueueMode,
    setRoomQueueMode,
    roomGenreFiltersInput,
    setRoomGenreFiltersInput,
    roomGenreFilters,
    genreSuggestionIndex,
    setGenreSuggestionIndex,
    roomAutoDjVoting,
    setRoomAutoDjVoting,
    selectGenre,
    removeGenre,
  };
}
