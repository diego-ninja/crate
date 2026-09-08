import { CRATE_ICON_SIZE, Loader2, Search, X } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  type TopBarSearchItem,
  type TopBarSearchRecentEntry,
} from "./topbar-search-model";
import { TopBarSearchDropdown } from "./TopBarSearchDropdown";

type TopBarSearchInputProps = {
  state: {
    query: string;
    results: TopBarSearchItem[];
    loading: boolean;
    completedQuery: string | null;
    searchError: string | null;
    showDropdown: boolean;
    activeIdx: number;
    recents: TopBarSearchRecentEntry[];
    searchOpen: boolean;
  };
  environment: { canHover: boolean; isDesktop: boolean };
  refs: {
    containerRef: { current: HTMLDivElement | null };
    dropdownRef: { current: HTMLDivElement | null };
    inputRef: { current: HTMLInputElement | null };
    dropdownStyle: { left: number; top: number; width: number } | null;
  };
  actions: {
    openSearch: (withDropdown?: boolean) => void;
    focusInputSoon: () => void;
    scheduleCollapseIfIdle: (nextShowDropdown?: boolean) => void;
    setQuery: (value: string) => void;
    setResults: (value: TopBarSearchItem[]) => void;
    setCompletedQuery: (value: string | null) => void;
    setSearchError: (value: string | null) => void;
    setShowDropdown: (value: boolean) => void;
    setExpanded: (value: boolean) => void;
  };
  handlers: {
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    selectItem: (item: TopBarSearchItem) => Promise<void>;
    selectRecent: (recent: TopBarSearchRecentEntry) => void;
  };
  navigate: (to: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
};

type TopBarSearchVisibility = {
  showResults: boolean;
  showRecents: boolean;
  showSearchError: boolean;
  showEmptyResults: boolean;
};

function getTopBarSearchVisibility({
  showDropdown,
  trimmedQuery,
  loading,
  completedQuery,
  searchError,
  results,
  recents,
}: {
  showDropdown: boolean;
  trimmedQuery: string;
  loading: boolean;
  completedQuery: string | null;
  searchError: string | null;
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
}): TopBarSearchVisibility {
  const showSearchError =
    showDropdown &&
    trimmedQuery.length > 0 &&
    !loading &&
    completedQuery === trimmedQuery &&
    Boolean(searchError);
  const showEmptyResults =
    showDropdown &&
    trimmedQuery.length > 0 &&
    !loading &&
    completedQuery === trimmedQuery &&
    !searchError &&
    results.length === 0;

  return {
    showRecents: showDropdown && !trimmedQuery && recents.length > 0,
    showSearchError,
    showEmptyResults,
    showResults:
      showDropdown &&
      trimmedQuery.length > 0 &&
      (results.length > 0 || loading || showEmptyResults || showSearchError),
  };
}

export function TopBarSearchInput({
  state,
  environment,
  refs,
  actions,
  handlers,
  navigate,
  t,
}: TopBarSearchInputProps) {
  const {
    query,
    results,
    loading,
    completedQuery,
    searchError,
    showDropdown,
    recents,
  } = state;
  const trimmedQuery = query.trim();
  const visibility = getTopBarSearchVisibility({
    showDropdown,
    trimmedQuery,
    loading,
    completedQuery,
    searchError,
    results,
    recents,
  });

  return (
    <TopBarSearchContainer
      state={state}
      environment={environment}
      refs={refs}
      actions={actions}
      handlers={handlers}
      visibility={visibility}
      trimmedQuery={trimmedQuery}
      navigate={navigate}
      t={t}
    />
  );
}

type TopBarSearchLayoutProps = TopBarSearchInputProps & {
  visibility: TopBarSearchVisibility;
  trimmedQuery: string;
};

function TopBarSearchContainer({
  state,
  environment,
  refs,
  actions,
  handlers,
  visibility,
  trimmedQuery,
  navigate,
  t,
}: TopBarSearchLayoutProps) {
  const { results, searchError, activeIdx, recents, searchOpen } = state;
  const { canHover } = environment;
  const { containerRef, dropdownRef, inputRef, dropdownStyle } = refs;
  const {
    openSearch,
    scheduleCollapseIfIdle,
    setQuery,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setExpanded,
  } = actions;
  const { handleKeyDown, selectItem, selectRecent } = handlers;

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative flex-1 shrink-0 overflow-visible md:flex-none md:origin-right",
        "transition-[width,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
        searchOpen
          ? "w-[min(22rem,calc(100vw-8.75rem))] sm:w-[min(24rem,calc(100vw-9.25rem))] md:w-[440px] lg:w-[500px]"
          : "w-[7.25rem] sm:w-[8rem] md:w-11",
      )}
      onMouseEnter={() => {
        if (canHover) openSearch(false);
      }}
      onMouseLeave={() => {
        if (canHover) scheduleCollapseIfIdle();
      }}
    >
      <TopBarSearchControls
        state={state}
        environment={environment}
        inputRef={inputRef}
        actions={actions}
        t={t}
        handlers={{ handleKeyDown }}
      />
      {dropdownStyle && (visibility.showResults || visibility.showRecents) ? (
        <TopBarSearchDropdown
          dropdownRef={dropdownRef}
          dropdownStyle={dropdownStyle}
          visibility={visibility}
          results={results}
          recents={recents}
          activeIdx={activeIdx}
          trimmedQuery={trimmedQuery}
          searchError={searchError}
          onSelectItem={selectItem}
          onSelectRecent={selectRecent}
          onSeeAllResults={() => {
            navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
            setShowDropdown(false);
            setQuery("");
            setExpanded(false);
            setCompletedQuery(null);
            setSearchError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TopBarSearchControls({
  state,
  environment,
  inputRef,
  actions,
  t,
  handlers,
}: {
  state: TopBarSearchInputProps["state"];
  environment: TopBarSearchInputProps["environment"];
  inputRef: TopBarSearchInputProps["refs"]["inputRef"];
  actions: TopBarSearchInputProps["actions"];
  t: TopBarSearchInputProps["t"];
  handlers: Pick<TopBarSearchInputProps["handlers"], "handleKeyDown">;
}) {
  const { query, loading, searchOpen } = state;
  const { isDesktop } = environment;
  const {
    openSearch,
    focusInputSoon,
    scheduleCollapseIfIdle,
    setQuery,
    setResults,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
  } = actions;

  return (
    <div
      data-state={searchOpen ? "open" : "closed"}
      className={cn(
        "relative overflow-visible rounded-xl transition-[background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
        isDesktop
          ? searchOpen
            ? "border border-text-primary/8 bg-surface-canvas/68 shadow-glass-hover"
            : "border-0 bg-transparent shadow-none backdrop-blur-0"
          : "listen-glass-panel listen-search-glass",
        searchOpen ? "md:scale-x-[1.01]" : "md:scale-x-100",
      )}
    >
      <div className="relative flex items-center overflow-hidden rounded-xl">
        <button
          type="button"
          aria-label={t("search.label")}
          aria-expanded={searchOpen}
          data-state={searchOpen ? "open" : "closed"}
          onFocus={() => openSearch(true)}
          onClick={() => {
            openSearch(true);
            focusInputSoon();
          }}
          className={cn(
            "absolute left-0 top-0 z-10 flex h-12 touch-manipulation items-center rounded-xl border-0 bg-transparent shadow-none backdrop-blur-0 transition-[color,transform,opacity,width,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none md:h-11 md:w-11 md:justify-center md:px-0",
            searchOpen
              ? "w-12 justify-center px-0 text-text-primary/42"
              : "w-full justify-start gap-2 px-4 text-text-primary/72 group-hover:scale-[1.03] group-hover:text-text-primary/88",
          )}
        >
          <Search size={CRATE_ICON_SIZE.md} />
          <span
            className={cn(
              "text-sm font-semibold tracking-[-0.01em] transition-[opacity,transform] duration-300 md:hidden",
              searchOpen
                ? "pointer-events-none -translate-x-1 opacity-0"
                : "translate-x-0 opacity-100",
            )}
          >
            {t("search.label")}
          </span>
        </button>
        {loading && searchOpen ? (
          <Loader2
            size={CRATE_ICON_SIZE.sm}
            className="absolute right-4 animate-spin text-text-primary/40"
          />
        ) : null}
        {!loading && query && searchOpen ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setCompletedQuery(null);
              setSearchError(null);
              setShowDropdown(true);
              focusInputSoon();
            }}
            className="absolute right-3 z-20 flex size-9 touch-manipulation items-center justify-center text-text-primary/30 hover:text-text-primary/65"
            aria-label={t("search.clear")}
          >
            <X size={CRATE_ICON_SIZE.lg} />
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          value={query}
          tabIndex={searchOpen ? 0 : -1}
          aria-hidden={!searchOpen}
          onChange={(e) => {
            openSearch(true);
            setQuery(e.target.value);
          }}
          onFocus={() => {
            openSearch(true);
          }}
          onBlur={() => {
            scheduleCollapseIfIdle();
          }}
          onKeyDown={handlers.handleKeyDown}
          placeholder={t("search.placeholder")}
          className={cn(
            "h-12 w-full rounded-xl border-0 bg-transparent pl-12 text-[16px] text-text-primary outline-none md:h-11 md:pl-11 md:text-[0.9375rem]",
            "transition-[opacity,transform,box-shadow,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
            "placeholder:text-text-primary/40",
            searchOpen
              ? "pointer-events-auto translate-x-0 scale-100 pr-11 opacity-100"
              : "pointer-events-none translate-x-3 scale-[0.985] pr-4 opacity-0",
          )}
        />
      </div>
    </div>
  );
}
