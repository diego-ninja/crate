import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";

import { cn } from "@/lib/utils";

type CrateLoaderVariant = "compact" | "page" | "screen";

const WRAPPER_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "py-12",
  page: "min-h-[min(46svh,28rem)] py-16",
  screen: "min-h-svh",
};

const MARK_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "h-24 w-24 p-[3px]",
  page: "h-32 w-32 p-1",
  screen: "h-36 w-36 p-1",
};

export const CRATE_LOADING_PHRASES = [
  "Feeding your soul",
  "Loading Crate",
  "Warming the amps",
  "Spinning up the collection",
  "Cueing the next obsession",
  "Tuning the room",
  "Checking the liner notes",
  "Dusting off the crates",
  "Finding something loud",
  "Syncing the signal",
] as const;

const CRATE_LOADING_PHRASE_KEYS = [
  "loader.phrases.feedingYourSoul",
  "loader.phrases.loadingCrate",
  "loader.phrases.warmingTheAmps",
  "loader.phrases.spinningUpTheCollection",
  "loader.phrases.cueingTheNextObsession",
  "loader.phrases.tuningTheRoom",
  "loader.phrases.checkingTheLinerNotes",
  "loader.phrases.dustingOffTheCrates",
  "loader.phrases.findingSomethingLoud",
  "loader.phrases.syncingTheSignal",
] as const;

interface CrateLoaderProps {
  className?: string;
  label?: string;
  variant?: CrateLoaderVariant;
}

export function CrateLoader({
  className,
  label,
  variant = "page",
}: CrateLoaderProps) {
  const { t } = useTranslation();
  const phrase = useMemo(() => {
    const index = Math.floor(Math.random() * CRATE_LOADING_PHRASE_KEYS.length);
    return CRATE_LOADING_PHRASE_KEYS[index] ?? CRATE_LOADING_PHRASE_KEYS[0];
  }, []);
  const accessibleLabel = label ?? t("loader.defaultLabel");

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative flex flex-col items-center justify-center gap-6 overflow-visible text-center",
        WRAPPER_CLASSES[variant],
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "group relative isolate flex shrink-0 items-center justify-center overflow-visible rounded-full",
          "crate-loader-mark",
          "brightness-110 saturate-125",
          MARK_CLASSES[variant],
        )}
      >
        <span className="crate-loader-aura pointer-events-none absolute -inset-[16px] z-0 origin-[46%_57%] animate-crate-play-aura-pulse rounded-[45%_55%_49%_51%/53%_47%_56%_44%] opacity-[0.72]" />
        <span className="crate-loader-rim pointer-events-none absolute inset-0 z-10 animate-crate-play-rim-pulse rounded-full" />
        <span className="crate-loader-core pointer-events-none absolute inset-[2px] z-20 animate-crate-play-core-pulse rounded-full" />
        <CrateLogo
          aria-hidden="true"
          effects={false}
          className="crate-loader-logo relative z-30 size-[58%] select-none"
        />
      </div>
      <p className="font-sans text-[0.9375rem] font-semibold tracking-[0.055em] text-text-accent/80">
        {t(phrase)}
        <span
          className="inline-flex w-[1.35em] justify-start"
          aria-hidden="true"
        >
          {["first", "second", "third"].map((key, index) => (
            <span
              key={key}
              aria-hidden="true"
              data-testid="crate-loader-dot"
              className="animate-crate-loader-dot-bounce"
              style={{ animationDelay: `${index * 140}ms` }}
            >
              .
            </span>
          ))}
        </span>
      </p>
      <span className="sr-only">{accessibleLabel}</span>
    </div>
  );
}
