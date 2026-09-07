import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Calendar, Play, Sparkles } from "@crate/ui/icons";

import type { HomeUpcomingInsight } from "./home-model";
import { SectionHeader } from "./HomeSections";

function insightLabel(type: HomeUpcomingInsight["type"], t: TFunction): string {
  if (type === "show_prep") return t("home.radar.insight.showPrep");
  if (type === "one_week") return t("home.radar.insight.thisWeek");
  return t("home.radar.insight.oneMonth");
}

export function HomeShowPrepSection({
  insights,
  onOpenUpcoming,
  onPlaySetlist,
  onSaveReminder,
}: {
  insights: HomeUpcomingInsight[];
  onOpenUpcoming: () => void;
  onPlaySetlist: (insight: HomeUpcomingInsight) => void;
  onSaveReminder: (insight: HomeUpcomingInsight) => void;
}) {
  const { t } = useTranslation();
  if (!insights.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.showPrep.title")}
        subtitle={t("home.radar.showPrep.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.type}:${insight.show_id}`}
            className="home-upcoming-show-prep-card rounded-[12px] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="home-upcoming-show-prep-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.16em]">
                  <Sparkles size={12} />
                  {insightLabel(insight.type, t)}
                </div>
                <h3 className="mt-3 text-lg font-bold text-text-primary">
                  {insight.title}
                </h3>
                <p className="home-upcoming-show-prep-subtitle mt-1 text-sm">
                  {insight.subtitle}
                </p>
              </div>
              {insight.weight === "high" ? (
                <div className="home-upcoming-show-prep-heavy rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em]">
                  {t("home.radar.showPrep.heavyRotation")}
                </div>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-text-muted">
              {insight.message}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {insight.has_setlist ? (
                <button
                  type="button"
                  onClick={() => onPlaySetlist(insight)}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
                >
                  <Play size={14} fill="currentColor" />
                  {t("radar.show.playSetlist")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onSaveReminder(insight)}
                className="home-upcoming-show-prep-reminder inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors"
              >
                <Calendar size={14} />
                {t("home.radar.showPrep.saveForLater")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
