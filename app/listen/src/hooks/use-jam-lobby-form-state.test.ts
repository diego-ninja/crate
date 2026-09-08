import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useJamLobbyFormState } from "@/hooks/use-jam-lobby-form-state";

describe("useJamLobbyFormState", () => {
  it("adds each genre once and clears the active suggestion input", () => {
    const { result } = renderHook(() => useJamLobbyFormState());

    act(() => {
      result.current.setRoomGenreFiltersInput("hard");
      result.current.setGenreSuggestionIndex(2);
      result.current.selectGenre({ slug: "hardcore", name: "Hardcore" });
      result.current.selectGenre({ slug: "hardcore", name: "Hardcore" });
    });

    expect(result.current.roomGenreFilters).toEqual(["hardcore"]);
    expect(result.current.roomGenreFiltersInput).toBe("");
    expect(result.current.genreSuggestionIndex).toBe(0);
  });

  it("removes a selected genre without changing the remaining filters", () => {
    const { result } = renderHook(() => useJamLobbyFormState());

    act(() => {
      result.current.selectGenre({ slug: "hardcore", name: "Hardcore" });
      result.current.selectGenre({ slug: "metalcore", name: "Metalcore" });
      result.current.removeGenre("hardcore");
    });

    expect(result.current.roomGenreFilters).toEqual(["metalcore"]);
  });
});
