import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { action } from "@/components/actions/shared";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { startShapedRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { Calendar, Radio, Share2 } from "@crate/ui/icons";

import type { GenreDetail } from "./explore-model";
import type { UpcomingItem } from "@/components/upcoming/UpcomingRows";

export function useGenreDetailActions({
  data,
  heroCoverUrl,
  nextShow,
}: {
  data: GenreDetail | null | undefined;
  heroCoverUrl: string | null;
  nextShow: UpcomingItem | null;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const [startingRadio, setStartingRadio] = useState(false);

  const handlePlayGenreRadio = useCallback(async () => {
    if (!data || startingRadio) return;
    setStartingRadio(true);
    try {
      const radio = await startShapedRadio(
        "seeded",
        "genre",
        data.canonical_slug || data.slug,
      );
      if (!radio?.tracks.length) {
        toast.info(t("genre.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("genre.toasts.radioFailed"));
    } finally {
      setStartingRadio(false);
    }
  }, [data, playAll, startingRadio, t]);

  const openGenreRadar = useCallback(
    (show?: UpcomingItem | null) => {
      if (!data) return;
      const params = new URLSearchParams({ genre: data.slug });
      if (show?.id != null) params.set("show", String(show.id));
      navigate(`/upcoming?${params.toString()}`);
    },
    [data, navigate],
  );

  const shareGenre = useCallback(() => {
    if (!data) return;
    openShareSheet({
      kind: "genre",
      title: data.name,
      subtitle: t("genre.kind"),
      imageUrl: heroCoverUrl,
      url: publicShareUrl(`/explore?genre=${encodeURIComponent(data.slug)}`),
    });
  }, [data, heroCoverUrl, t]);

  const genreMenuActions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!data) return [];
    return [
      action({
        key: "play-radio",
        label: t("genre.actions.playRadio"),
        icon: Radio,
        onSelect: handlePlayGenreRadio,
      }),
      action({
        key: "radar",
        label: nextShow
          ? t("genre.actions.openNextShow")
          : t("genre.actions.openRadar"),
        icon: Calendar,
        disabled: !nextShow,
        onSelect: () => openGenreRadar(nextShow),
      }),
      action({
        key: "share",
        label: t("genre.actions.share"),
        icon: Share2,
        onSelect: shareGenre,
      }),
    ];
  }, [data, handlePlayGenreRadio, nextShow, openGenreRadar, shareGenre, t]);

  return {
    startingRadio,
    handlePlayGenreRadio,
    openGenreRadar,
    shareGenre,
    genreMenuActions,
    genreMenu: useItemActionMenu(genreMenuActions),
  };
}
