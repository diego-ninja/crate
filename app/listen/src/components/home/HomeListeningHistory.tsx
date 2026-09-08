import { useTranslation } from "react-i18next";

import { EditorialPlaylistArtwork } from "@/components/playlists/EditorialPlaylistArtwork";
import { SectionHeader } from "@/components/home/HomeSections";
import { cn } from "@/lib/utils";

import type { HomeListeningHistoryCard } from "./home-model";

const HISTORY_TONES = [
  "home-history-tone-1",
  "home-history-tone-2",
  "home-history-tone-3",
  "home-history-tone-4",
  "home-history-tone-5",
  "home-history-tone-6",
];

function historyLabel(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "MY MOST LISTENED";
  return item.period_label;
}

function historyKicker(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return "Crate History";
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Listening History";
  return String(date.getFullYear());
}

function historyDisplayTitle(item: HomeListeningHistoryCard): string {
  if (item.kind === "all_time") return item.title;
  if (item.title !== "My Most Listened") return item.title;
  const date = new Date(`${item.period_start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return item.title;
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatHistoryMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

export function ListeningHistorySection({
  items,
  onOpenHistory,
}: {
  items: HomeListeningHistoryCard[];
  onOpenHistory: (item?: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const featured = items.slice(0, 4);

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        subtitle={t("home.sections.listeningDna.subtitle")}
        actionLabel={t("home.sections.listeningDna.action")}
        onAction={() => onOpenHistory()}
      />
      <div className="flex flex-wrap gap-5">
        {featured.map((item, index) => (
          <ListeningHistoryCard
            key={item.id}
            item={item}
            index={index}
            onOpen={onOpenHistory}
          />
        ))}
      </div>
    </section>
  );
}

function ListeningHistoryCard({
  item,
  index,
  onOpen,
}: {
  item: HomeListeningHistoryCard;
  index: number;
  onOpen: (item: HomeListeningHistoryCard) => void;
}) {
  const { t } = useTranslation();
  const artists =
    item.subtitle || t("home.sections.listeningDna.defaultSubtitle");

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group w-[min(42vw,13rem)] shrink-0 touch-manipulation text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas lg:w-56"
    >
      <EditorialPlaylistArtwork
        title={historyLabel(item)}
        kicker={historyKicker(item)}
        tracks={item.artwork_tracks}
        variant="history"
        className={cn(
          "home-history-card aspect-[1.12] rounded-xl",
          HISTORY_TONES[index % HISTORY_TONES.length],
        )}
        textClassName={cn(
          item.kind === "all_time"
            ? "[&_div:first-child]:text-[clamp(1.2rem,13cqw,2.45rem)]"
            : "[&_div:first-child]:text-[clamp(2rem,20cqw,3.35rem)]",
        )}
      />
      <div className="mt-2.5 flex min-h-[5.4rem] flex-col">
        <div className="truncate text-sm font-black tracking-[-0.035em] text-text-primary">
          {historyDisplayTitle(item)}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-text-muted">
          {artists}
        </p>
        <div className="home-history-meta mt-auto text-xs font-bold uppercase tracking-[0.14em]">
          {t("common.playCount", { count: item.play_count })} ·{" "}
          {formatHistoryMinutes(item.minutes_listened)}
        </div>
      </div>
    </button>
  );
}
