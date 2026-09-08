import { useEffect, useState } from "react";

import { api } from "@/lib/api";

import type { EnrichmentData } from "./artist-bio-types";

export function useArtistBioEnrichment(open: boolean, artistId?: number) {
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);

  useEffect(() => {
    if (!open || !artistId) {
      setEnrichment(null);
      return;
    }

    let cancelled = false;
    setEnrichment(null);
    api<EnrichmentData>(`/api/artists/${artistId}/enrichment`)
      .then((data) => {
        if (!cancelled) setEnrichment(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, artistId]);

  return enrichment;
}
