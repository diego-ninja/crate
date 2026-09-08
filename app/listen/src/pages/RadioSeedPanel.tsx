import { useTranslation } from "react-i18next";
import { Music, Radio as RadioIcon, Loader2 } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";

import type { SearchResult } from "./radio-model";

export function RadioSeedPanel({
  query,
  searching,
  results,
  starting,
  onQueryChange,
  onStartSeeded,
}: {
  query: string;
  searching: boolean;
  results: SearchResult[];
  starting: boolean;
  onQueryChange: (query: string) => void;
  onStartSeeded: (seed: SearchResult) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="radio-seed-panel rounded-[12px] p-5">
      <div className="radio-seed-heading mb-4 flex items-center gap-2 text-sm font-semibold">
        <RadioIcon size={16} className="radio-seed-heading-icon" />
        {t("radio.seed.title")}
      </div>

      <input
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("radio.seed.placeholder")}
        className="radio-seed-input h-12 w-full rounded-lg px-4 text-base"
      />

      {searching && (
        <Loader2 size={14} className="radio-seed-spinner mt-2 animate-spin" />
      )}

      {results.length > 0 && (
        <div className="radio-seed-results mt-2 space-y-0.5 rounded-xl p-1.5">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.value}`}
              onClick={() => onStartSeeded(result)}
              disabled={starting}
              className="radio-seed-result flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition"
            >
              {result.imageUrl ? (
                <CrateImage
                  src={result.imageUrl}
                  alt=""
                  className={`radio-seed-result-image size-9 shrink-0 object-cover ${
                    result.type === "artist" ? "rounded-full" : "rounded-md"
                  }`}
                />
              ) : (
                <div className="radio-seed-result-placeholder flex size-9 shrink-0 items-center justify-center rounded-md">
                  <Music size={16} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{result.label}</div>
                <div className="radio-seed-result-type text-xs">
                  {t("radio.seed.resultType", { type: result.type })}
                </div>
              </div>
              <RadioIcon
                size={14}
                className="radio-seed-result-icon shrink-0"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
