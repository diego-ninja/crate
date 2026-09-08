import { useCallback, useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { checkDiscoveryAvailable, startShapedRadio } from "@/lib/radio";

import {
  buildSearchResults,
  initialRadioState,
  radioReducer,
  stationLabel,
  stationSeedValue,
  type PersonalizedRadioStation,
  type PersonalizedRadioStationsResponse,
  type RadioGenre,
  type RadioSearchResponse,
  type SearchResult,
} from "./radio-model";

export function useRadioController() {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const {
    data: stationGroups,
    loading: stationsLoading,
    error: stationsError,
  } = useApi<PersonalizedRadioStationsResponse>("/api/radio/stations");
  const [state, dispatch] = useReducer(radioReducer, initialRadioState);

  useEffect(() => {
    checkDiscoveryAvailable().then((available) => {
      dispatch({ type: "set-discovery-available", value: available });
    });
  }, []);

  const search = useCallback(async (query: string) => {
    if (query.length < 2) {
      dispatch({ type: "search-cleared" });
      return;
    }
    dispatch({ type: "search-started" });
    try {
      const [searchData, genresData] = await Promise.all([
        api<RadioSearchResponse>(
          `/api/catalog/search?q=${encodeURIComponent(query)}&limit=5`,
        ),
        api<RadioGenre[]>("/api/genres"),
      ]);
      dispatch({
        type: "search-succeeded",
        value: buildSearchResults(searchData, genresData, query),
      });
    } catch {
      dispatch({ type: "search-failed" });
    } finally {
      dispatch({ type: "search-finished" });
    }
  }, []);

  const onQueryChange = useCallback(
    (query: string) => {
      dispatch({ type: "set-query", value: query });
      void search(query);
    },
    [search],
  );

  const startStation = useCallback(
    async (station: PersonalizedRadioStation) => {
      dispatch({ type: "start-request" });
      const result = await startShapedRadio(
        "seeded",
        station.seed_type,
        stationSeedValue(station),
      );
      if (!result) {
        toast.error(t("radio.toasts.startFailed"));
        dispatch({ type: "start-failed" });
        return;
      }
      dispatch({
        type: "radio-started",
        sessionId: result.sessionId,
        mode: "seeded",
        seedLabel: result.seedLabel || stationLabel(station),
      });
      playAll(result.tracks, 0, result.source);
    },
    [playAll, t],
  );

  const startSeeded = useCallback(
    async (seed: SearchResult) => {
      dispatch({ type: "start-request" });
      dispatch({ type: "set-query", value: "" });
      dispatch({ type: "search-cleared" });
      const result = await startShapedRadio("seeded", seed.type, seed.value);
      if (!result) {
        toast.error(t("radio.toasts.startFailed"));
        dispatch({ type: "start-failed" });
        return;
      }
      dispatch({
        type: "radio-started",
        sessionId: result.sessionId,
        mode: "seeded",
        seedLabel: result.seedLabel,
      });
      playAll(result.tracks, 0, result.source);
    },
    [playAll, t],
  );

  const startDiscovery = useCallback(async () => {
    dispatch({ type: "start-request" });
    const result = await startShapedRadio("discovery");
    if (!result) {
      toast.error(t("radio.toasts.discoveryUnavailable"));
      dispatch({ type: "start-failed" });
      return;
    }
    dispatch({
      type: "radio-started",
      sessionId: result.sessionId,
      mode: "discovery",
      seedLabel: t("radio.discovery"),
    });
    playAll(result.tracks, 0, result.source);
  }, [playAll, t]);

  return {
    artistStations: stationGroups?.artist_stations ?? [],
    genreStations: stationGroups?.genre_stations ?? [],
    stationsLoading,
    stationsError,
    discoveryAvailable: state.discoveryAvailable,
    starting: state.starting,
    activeSession: state.activeSession,
    activeMode: state.activeMode,
    seedLabel: state.seedLabel,
    query: state.query,
    results: state.results,
    searching: state.searching,
    onQueryChange,
    startDiscovery,
    startSeeded,
    startStation,
  };
}
