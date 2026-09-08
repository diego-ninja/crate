import { useMemo } from "react";

import type { JamRoom } from "@/pages/jam-reducer";
import { useApi } from "@/hooks/use-api";

export interface GenreTaxonomyNode {
  slug: string;
  name: string;
  alias_names?: string[];
}

interface GenreTaxonomyTreeResponse {
  nodes: GenreTaxonomyNode[];
}

const EMPTY_GENRE_TAXONOMY_NODES: GenreTaxonomyNode[] = [];

export function useJamLobbyData({
  roomId,
  roomQueueMode,
  roomGenreFilters,
  roomGenreFiltersInput,
  visibleRooms,
  userId,
}: {
  roomId?: string;
  roomQueueMode: "manual" | "auto" | "auto_dj";
  roomGenreFilters: string[];
  roomGenreFiltersInput: string;
  visibleRooms: JamRoom[];
  userId?: number;
}) {
  const taxonomyUrl =
    !roomId && roomQueueMode === "auto_dj" ? "/api/genres/taxonomy/tree" : null;
  const { data: taxonomyData, loading: taxonomyLoading } =
    useApi<GenreTaxonomyTreeResponse>(taxonomyUrl);

  const taxonomyNodes = taxonomyData?.nodes ?? EMPTY_GENRE_TAXONOMY_NODES;
  const taxonomyBySlug = useMemo(
    () => new Map(taxonomyNodes.map((node) => [node.slug, node])),
    [taxonomyNodes],
  );
  const genreSuggestions = useMemo(() => {
    const query = roomGenreFiltersInput.trim().toLocaleLowerCase();
    if (!query) return [];
    const selected = new Set(roomGenreFilters);
    return taxonomyNodes
      .filter((node) => {
        if (selected.has(node.slug)) return false;
        return [node.name, node.slug, ...(node.alias_names ?? [])].some(
          (value) => value.toLocaleLowerCase().includes(query),
        );
      })
      .sort((left, right) => {
        const leftName = left.name.toLocaleLowerCase();
        const rightName = right.name.toLocaleLowerCase();
        const leftStarts = leftName.startsWith(query) ? 0 : 1;
        const rightStarts = rightName.startsWith(query) ? 0 : 1;
        return leftStarts - rightStarts || leftName.localeCompare(rightName);
      })
      .slice(0, 8);
  }, [roomGenreFilters, roomGenreFiltersInput, taxonomyNodes]);
  const selectedGenreItems = useMemo(
    () =>
      roomGenreFilters.map((slug) => {
        const node = taxonomyBySlug.get(slug);
        return {
          name: node?.name ?? slug,
          slug,
        };
      }),
    [roomGenreFilters, taxonomyBySlug],
  );
  const { memberRooms, publicRooms } = useMemo(() => {
    const mine: JamRoom[] = [];
    const discoverable: JamRoom[] = [];
    for (const listedRoom of visibleRooms) {
      const isMember =
        listedRoom.is_member ??
        listedRoom.members.some((member) => member.user_id === userId);
      if (isMember) {
        mine.push(listedRoom);
      } else if (listedRoom.visibility === "public") {
        discoverable.push(listedRoom);
      }
    }
    return { memberRooms: mine, publicRooms: discoverable };
  }, [userId, visibleRooms]);

  return {
    taxonomyLoading,
    taxonomyNodes,
    genreSuggestions,
    selectedGenreItems,
    memberRooms,
    publicRooms,
  };
}
