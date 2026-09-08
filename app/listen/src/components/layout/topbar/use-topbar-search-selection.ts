import { useCallback } from "react";
import type { SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";
import {
  addTopBarSearchRecent,
  getTopBarSearchRecents,
  type TopBarSearchRecentEntry,
  type TopBarSearchItem,
} from "./topbar-search-model";

export function useTopBarSearchSelection({
  query,
  results,
  recents,
  activeIdx,
  navigate,
  play,
  t,
  focusInputSoon,
  setQuery,
  setResults,
  setCompletedQuery,
  setSearchError,
  setShowDropdown,
  setActiveIdx,
  setRecents,
  setExpanded,
  closeSearch,
}: {
  query: string;
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
  activeIdx: number;
  navigate: (to: string) => void;
  play: ReturnType<typeof usePlayerActions>["play"];
  t: ReturnType<typeof useTranslation>["t"];
  focusInputSoon: () => void;
  setQuery: (value: string) => void;
  setResults: (value: TopBarSearchItem[]) => void;
  setCompletedQuery: (value: string | null) => void;
  setSearchError: (value: string | null) => void;
  setShowDropdown: (value: boolean) => void;
  setActiveIdx: (value: SetStateAction<number>) => void;
  setRecents: (value: TopBarSearchRecentEntry[]) => void;
  setExpanded: (value: boolean) => void;
  closeSearch: () => void;
}) {
  const selectItem = useCallback(
    async (item: TopBarSearchItem) => {
      addTopBarSearchRecent(item);
      setRecents(getTopBarSearchRecents());
      if (item.trackData) {
        try {
          const resolved = await resolveRemotePlayableTrack({
            ...item.trackData,
            albumCover: item.imageUrl,
          });
          play(resolved, { type: "queue", name: "Search" });
        } catch {
          setSearchError(t("search.tryAgain"));
          return;
        }
      } else if (item.navigateTo) {
        navigate(item.navigateTo);
      }
      setShowDropdown(false);
      setQuery("");
      setExpanded(false);
      setCompletedQuery(null);
      setSearchError(null);
    },
    [
      navigate,
      play,
      setCompletedQuery,
      setExpanded,
      setQuery,
      setRecents,
      setSearchError,
      setShowDropdown,
      t,
    ],
  );

  const selectRecent = useCallback(
    (recent: TopBarSearchRecentEntry) => {
      addTopBarSearchRecent(recent);
      setRecents(getTopBarSearchRecents());

      if (recent.navigateTo) {
        navigate(recent.navigateTo);
        setShowDropdown(false);
        setExpanded(false);
        setQuery("");
        setResults([]);
        setCompletedQuery(null);
        setSearchError(null);
        return;
      }

      setExpanded(true);
      setQuery(recent.label);
      setShowDropdown(true);
      focusInputSoon();
    },
    [
      focusInputSoon,
      navigate,
      setCompletedQuery,
      setExpanded,
      setQuery,
      setRecents,
      setResults,
      setSearchError,
      setShowDropdown,
    ],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const items = query.trim()
      ? results
      : recents.map((recent) => ({ type: recent.type, label: recent.label }));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      if (query.trim() && results[activeIdx]) {
        void selectItem(results[activeIdx]);
      } else if (!query.trim() && recents[activeIdx]) {
        selectRecent(recents[activeIdx]);
      }
    } else if (e.key === "Escape") {
      closeSearch();
    }
  }

  return { handleKeyDown, selectItem, selectRecent };
}
