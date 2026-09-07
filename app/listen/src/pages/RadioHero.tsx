import { Loader2, Radio as RadioIcon, Sparkles } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

export function RadioHero({
  starting,
  discoveryAvailable,
  onStartDiscovery,
}: {
  starting: boolean;
  discoveryAvailable: boolean;
  onStartDiscovery: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="radio-page-hero relative overflow-hidden rounded-[12px] p-5 sm:p-6">
      <div className="radio-page-hero-glow pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="radio-page-icon flex size-14 shrink-0 items-center justify-center rounded-xl">
            <RadioIcon size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-text-primary text-3xl font-bold leading-tight">
              {t("radio.title")}
            </h1>
            <p className="radio-page-intro mt-1 max-w-2xl text-sm leading-relaxed">
              {t("radio.intro")}
            </p>
          </div>
        </div>

        <button
          onClick={onStartDiscovery}
          disabled={starting || !discoveryAvailable}
          className="radio-discovery-button group inline-flex min-h-12 items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold transition duration-300"
        >
          {starting ? (
            <Loader2 size={19} className="animate-spin" />
          ) : (
            <Sparkles size={19} />
          )}
          {t("radio.discovery")}
        </button>
      </div>
    </div>
  );
}
