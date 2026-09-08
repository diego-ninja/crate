import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "@crate/ui/icons";
import { Link } from "react-router";

import type { StatsPageController } from "@/pages/use-stats-page-controller";
import type { StatsAffinity } from "@/components/stats/stats-model";
import { cn } from "@/lib/utils";

const NARRATIVE_TONES = [
  "stats-narrative-tone-cool",
  "stats-narrative-tone-warm",
  "stats-narrative-tone-alert",
];

export function StatsRecapSection({
  highlights,
  t,
}: {
  highlights: StatsPageController["recapHighlights"];
  t: StatsPageController["t"];
}) {
  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-3">
      {highlights.length > 0 ? (
        highlights.map((item, index) => (
          <NarrativeTile key={item.title} index={index} {...item} />
        ))
      ) : (
        <div className="stats-card-empty rounded-[12px] border-dashed p-6 text-sm lg:col-span-3">
          {t("stats.empty.recap")}
        </div>
      )}
    </section>
  );
}

export function StatsEmptyState({ t }: { t: StatsPageController["t"] }) {
  return (
    <div className="stats-card-empty mt-8 rounded-[12px] border-dashed p-8 text-center">
      <h2 className="text-xl font-black text-text-primary">
        {t("stats.empty.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-text-muted">
        {t("stats.empty.body")}
      </p>
    </div>
  );
}

export function ScopeLink({
  active,
  to,
  children,
}: {
  active: boolean;
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] transition-colors",
        active
          ? "border-accent-action/30 bg-accent-action/15 text-accent-action"
          : "stats-scope-link-inactive",
      )}
    >
      {children}
    </Link>
  );
}

export function AffinityCard({
  affinity,
  subject,
}: {
  affinity?: StatsAffinity | null;
  subject?: string | null;
}) {
  const { t } = useTranslation();
  if (!affinity) return null;

  const reasons = affinity.affinity_reasons ?? [];
  const bandKey = "stats.affinity.band." + affinity.affinity_band;
  const bandFallback = affinity.affinity_band.replace("_", " ");
  return (
    <section className="stats-affinity-card mt-8 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-accent-action/25 bg-accent-action/15 text-accent-action">
            <Users size={20} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
              {t("stats.affinity.title")}
            </div>
            <h2 className="mt-2 text-3xl font-black uppercase leading-none tracking-[-0.06em] text-text-primary">
              {t("stats.affinity.score", {
                score: affinity.affinity_score,
              })}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              {subject
                ? t("stats.affinity.subjectBody", { subject })
                : t("stats.affinity.listenerBody")}
            </p>
          </div>
        </div>
        <div className="stats-muted-pill rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em]">
          {t(bandKey, { defaultValue: bandFallback })}
        </div>
      </div>
      {reasons.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <span
              key={reason}
              className="stats-muted-chip rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NarrativeTile({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  index: number;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "stats-narrative-tile rounded-[12px] p-5",
        NARRATIVE_TONES[index % NARRATIVE_TONES.length],
      )}
    >
      <div className="stats-muted-label text-xs font-black uppercase tracking-[0.22em]">
        {t("stats.narrative.signal", {
          number: String(index + 1).padStart(2, "0"),
        })}
      </div>
      <div className="mt-3 text-xl font-black tracking-[-0.05em] text-text-primary">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}
