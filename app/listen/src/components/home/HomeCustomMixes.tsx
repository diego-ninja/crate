import { useTranslation } from "react-i18next";
import { Play, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { MixArtwork } from "@/components/home/MixArtwork";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { cn } from "@/lib/utils";

import type { HomeGeneratedPlaylistSummary, HomeSectionId } from "./home-model";

function mixArtistSummary(item: HomeGeneratedPlaylistSummary): string {
  const names = (item.artwork_artists || []).flatMap((artist) => {
    const name = artist.artist_name?.trim();
    return name ? [name] : [];
  });

  if (!names.length) return item.description;
  const [first = "", second = "", third = ""] = names;
  if (names.length === 1) return first;
  if (names.length === 2) return `${first}, ${second}`;
  if (names.length === 3) return `${first}, ${second}, ${third}`;
  return `${first}, ${second}, ${third} and more`;
}

export function CustomMixesSection({
  mixes,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  onViewAll,
}: {
  mixes: HomeGeneratedPlaylistSummary[];
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(mixes.length);
  if (!mixes.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.customMixes.title")}
        subtitle={t("home.sections.customMixes.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("custom-mixes")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {mixes.map((mix) => (
          <CustomMixCard
            key={mix.id}
            item={mix}
            onOpenMix={onOpenMix}
            onPlayMix={onPlayMix}
            onShuffleMix={onShuffleMix}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CustomMixCard({
  item,
  onOpenMix,
  onPlayMix,
  onShuffleMix,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onPlayMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onShuffleMix: (mix: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (mix: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayMix(item),
    onShuffle: () => onShuffleMix(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenMix(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenMix(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      <div className="home-discovery-artwork relative mb-2 overflow-hidden rounded-xl">
        <MixArtwork
          item={item}
          className="aspect-square rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        <div className="home-discovery-artwork-overlay absolute inset-0 flex items-center justify-center">
          <button
            className="home-discovery-play-button flex size-10 translate-y-2 items-center justify-center rounded-full opacity-0 shadow-lg transition-[transform,opacity] focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayMix(item);
            }}
          >
            <Play
              size={18}
              fill="currentColor"
              className="ml-0.5 text-accent-action-foreground"
            />
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-semibold text-text-primary">
        {item.name}
      </div>
      <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-text-muted">
        {mixArtistSummary(item)}
      </div>
      <div className="home-discovery-meta mt-2 text-xs uppercase tracking-[0.18em]">
        {t("common.trackCount", { count: item.track_count })}
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.name,
          subtitle: mixArtistSummary(item),
          detail: t("common.trackCount", { count: item.track_count }),
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
