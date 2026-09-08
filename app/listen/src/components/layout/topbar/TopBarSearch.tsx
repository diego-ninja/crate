import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import {
  useTopBarSearchLifecycle,
  useTopBarSearchSelection,
  useTopBarSearchState,
} from "./TopBarSearchController";
import { TopBarSearchInput } from "./TopBarSearchView";

export function TopBarSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { play } = usePlayerActions();
  const canHover = useHoverCapability();
  const isDesktop = useIsDesktop();
  const {
    query,
    results,
    loading,
    completedQuery,
    searchError,
    showDropdown,
    activeIdx,
    recents,
    expanded,
    queryRef,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
  } = useTopBarSearchState();

  const queryActive = query.trim().length > 0;
  const searchOpen = expanded || showDropdown || queryActive;

  useEffect(() => {
    if (query.trim()) {
      setExpanded(true);
      setShowDropdown(true);
    }
  }, [query, setExpanded, setShowDropdown]);

  const lifecycle = useTopBarSearchLifecycle({
    searchOpen,
    showDropdown,
    queryRef,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setExpanded,
  });

  useDismissibleLayer({
    active: showDropdown,
    refs: [lifecycle.containerRef, lifecycle.dropdownRef, lifecycle.inputRef],
    onDismiss: () => {
      setShowDropdown(false);
      lifecycle.scheduleCollapseIfIdle(false);
    },
    closeOnEscape: false,
  });

  const handlers = useTopBarSearchSelection({
    query,
    results,
    recents,
    activeIdx,
    navigate,
    play,
    t,
    focusInputSoon: lifecycle.focusInputSoon,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
    closeSearch: lifecycle.closeSearch,
  });

  return (
    <TopBarSearchInput
      state={{
        query,
        results,
        loading,
        completedQuery,
        searchError,
        showDropdown,
        activeIdx,
        recents,
        searchOpen,
      }}
      environment={{ canHover, isDesktop }}
      refs={{
        containerRef: lifecycle.containerRef,
        dropdownRef: lifecycle.dropdownRef,
        inputRef: lifecycle.inputRef,
        dropdownStyle: lifecycle.dropdownStyle,
      }}
      actions={{
        openSearch: lifecycle.openSearch,
        focusInputSoon: lifecycle.focusInputSoon,
        scheduleCollapseIfIdle: lifecycle.scheduleCollapseIfIdle,
        setQuery,
        setResults,
        setCompletedQuery,
        setSearchError,
        setShowDropdown,
        setExpanded,
      }}
      handlers={handlers}
      navigate={navigate}
      t={t}
    />
  );
}
