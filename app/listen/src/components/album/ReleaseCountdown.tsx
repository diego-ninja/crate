import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const SECOND_MS = 1_000;

type CountdownUnit = {
  label: string;
  value: number;
};

function releaseTimestamp(releaseDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releaseDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day);
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }

  return target.getTime();
}

function pad(value: number): string {
  return String(Math.max(0, value)).padStart(2, "0");
}

export function ReleaseCountdown({ releaseDate }: { releaseDate: string }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const target = releaseTimestamp(releaseDate);
  const remaining = target == null ? 0 : Math.max(0, target - now);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [i18n.language],
  );

  useEffect(() => {
    if (target == null || target <= Date.now()) return;

    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= target) window.clearInterval(timer);
    }, SECOND_MS);
    return () => window.clearInterval(timer);
  }, [target]);

  if (target == null || target <= now) return null;

  const totalSeconds = Math.floor(remaining / SECOND_MS);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const units: CountdownUnit[] = [
    { label: t("album.releaseCountdown.days"), value: days },
    { label: t("album.releaseCountdown.hours"), value: hours },
    { label: t("album.releaseCountdown.minutes"), value: minutes },
    { label: t("album.releaseCountdown.seconds"), value: seconds },
  ];
  const formattedDate = dateFormatter.format(new Date(target));

  return (
    <section
      data-testid="release-countdown"
      aria-label={t("album.releaseCountdown.ariaLabel", {
        date: formattedDate,
      })}
      className="release-countdown-surface relative mt-5 w-full max-w-[34rem] overflow-hidden rounded-[12px] border border-text-primary/20 px-4 pb-4 pt-3 shadow-card backdrop-blur-2xl backdrop-saturate-150 sm:mt-4 sm:border-border-quiet sm:px-5 sm:backdrop-blur-none sm:backdrop-saturate-100"
    >
      <div
        data-testid="release-countdown-glass-sheen"
        aria-hidden="true"
        className="release-countdown-sheen pointer-events-none absolute inset-0 sm:hidden"
      />
      <div className="relative flex items-baseline justify-between gap-3 font-mono text-xs font-medium uppercase tracking-[0.16em] text-accent-action">
        <span>{t("album.releaseCountdown.title")}</span>
        <time dateTime={releaseDate} className="shrink-0 text-text-primary/55">
          {formattedDate}
        </time>
      </div>
      <dl className="relative mt-3 flex items-stretch">
        {units.map((unit, index) => (
          <Fragment key={unit.label}>
            {index > 0 ? (
              <div
                data-testid="release-countdown-separator"
                aria-hidden="true"
                className="mx-1.5 h-9 w-px shrink-0 self-center bg-text-primary/12 sm:mx-2"
              />
            ) : null}
            <div className="min-w-0 flex-1 px-0.5 text-center">
              <dd className="font-mono text-[clamp(1.75rem,9vw,2.75rem)] font-bold leading-none tracking-[-0.075em] text-text-primary tabular-nums">
                {pad(unit.value)}
              </dd>
              <dt className="mt-2 truncate font-mono text-xs font-medium uppercase tracking-[0.13em] text-text-primary/48 sm:text-xs">
                {unit.label}
              </dt>
            </div>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
