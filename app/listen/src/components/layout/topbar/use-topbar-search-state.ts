import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "@/lib/api";
import {
  flattenTopBarSearchResults,
  getTopBarSearchRecents,
  type SearchResult,
  type TopBarSearchRecentEntry,
  type TopBarSearchItem,
} from "./topbar-search-model";

function searchErrorHint(
  error: unknown,
  messages: { session: string; generic: string },
): string {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return messages.session;
  }
  return messages.generic;
}

type TopBarSearchState = {
  query: string;
  results: TopBarSearchItem[];
  loading: boolean;
  completedQuery: string | null;
  searchError: string | null;
  showDropdown: boolean;
  activeIdx: number;
  recents: TopBarSearchRecentEntry[];
  expanded: boolean;
};

type TopBarSearchAction =
  | { type: "set-query"; value: string }
  | { type: "set-results"; value: TopBarSearchItem[] }
  | { type: "set-loading"; value: boolean }
  | { type: "set-completed-query"; value: string | null }
  | { type: "set-search-error"; value: string | null }
  | { type: "set-show-dropdown"; value: boolean }
  | { type: "set-active-index"; value: SetStateAction<number> }
  | { type: "set-recents"; value: TopBarSearchRecentEntry[] }
  | { type: "set-expanded"; value: boolean };

const initialTopBarSearchState: TopBarSearchState = {
  query: "",
  results: [],
  loading: false,
  completedQuery: null,
  searchError: null,
  showDropdown: false,
  activeIdx: -1,
  recents: [],
  expanded: false,
};

function topBarSearchReducer(
  state: TopBarSearchState,
  action: TopBarSearchAction,
): TopBarSearchState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.value };
    case "set-results":
      return { ...state, results: action.value };
    case "set-loading":
      return { ...state, loading: action.value };
    case "set-completed-query":
      return { ...state, completedQuery: action.value };
    case "set-search-error":
      return { ...state, searchError: action.value };
    case "set-show-dropdown":
      return { ...state, showDropdown: action.value };
    case "set-active-index":
      return {
        ...state,
        activeIdx:
          typeof action.value === "function"
            ? action.value(state.activeIdx)
            : action.value,
      };
    case "set-recents":
      return { ...state, recents: action.value };
    case "set-expanded":
      return { ...state, expanded: action.value };
  }
}

export function useTopBarSearchState() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    topBarSearchReducer,
    initialTopBarSearchState,
    (initialState) => ({
      ...initialState,
      recents: getTopBarSearchRecents(),
    }),
  );
  const queryRef = useRef(state.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    queryRef.current = state.query;
  }, [state.query]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestQuery = state.query.trim();
    if (!requestQuery) {
      dispatch({ type: "set-results", value: [] });
      dispatch({ type: "set-loading", value: false });
      dispatch({ type: "set-completed-query", value: null });
      dispatch({ type: "set-search-error", value: null });
      return;
    }

    dispatch({ type: "set-loading", value: true });
    dispatch({ type: "set-completed-query", value: null });
    dispatch({ type: "set-search-error", value: null });
    debounceRef.current = setTimeout(() => {
      api<SearchResult>(
        `/api/catalog/search?q=${encodeURIComponent(requestQuery)}&limit=10`,
      )
        .then((data) => {
          if (queryRef.current.trim() !== requestQuery) return;
          dispatch({
            type: "set-results",
            value: flattenTopBarSearchResults(data),
          });
          dispatch({ type: "set-active-index", value: -1 });
          dispatch({ type: "set-completed-query", value: requestQuery });
          dispatch({ type: "set-search-error", value: null });
        })
        .catch((error) => {
          if (queryRef.current.trim() !== requestQuery) return;
          dispatch({ type: "set-results", value: [] });
          dispatch({ type: "set-active-index", value: -1 });
          dispatch({ type: "set-completed-query", value: requestQuery });
          dispatch({
            type: "set-search-error",
            value: searchErrorHint(error, {
              session: t("search.errors.sessionRefresh"),
              generic: t("search.errors.tryAgain"),
            }),
          });
        })
        .finally(() => {
          if (queryRef.current.trim() === requestQuery) {
            dispatch({ type: "set-loading", value: false });
          }
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state.query, t]);

  const setQuery = useCallback(
    (value: string) => dispatch({ type: "set-query", value }),
    [],
  );
  const setResults = useCallback(
    (value: TopBarSearchItem[]) => dispatch({ type: "set-results", value }),
    [],
  );
  const setLoading = useCallback(
    (value: boolean) => dispatch({ type: "set-loading", value }),
    [],
  );
  const setCompletedQuery = useCallback(
    (value: string | null) => dispatch({ type: "set-completed-query", value }),
    [],
  );
  const setSearchError = useCallback(
    (value: string | null) => dispatch({ type: "set-search-error", value }),
    [],
  );
  const setShowDropdown = useCallback(
    (value: boolean) => dispatch({ type: "set-show-dropdown", value }),
    [],
  );
  const setActiveIdx = useCallback(
    (value: SetStateAction<number>) =>
      dispatch({ type: "set-active-index", value }),
    [],
  );
  const setRecents = useCallback(
    (value: TopBarSearchRecentEntry[]) =>
      dispatch({ type: "set-recents", value }),
    [],
  );
  const setExpanded = useCallback(
    (value: boolean) => dispatch({ type: "set-expanded", value }),
    [],
  );

  return {
    ...state,
    queryRef,
    setQuery,
    setResults,
    setLoading,
    setCompletedQuery,
    setSearchError,
    setShowDropdown,
    setActiveIdx,
    setRecents,
    setExpanded,
  };
}
