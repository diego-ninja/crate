import { useTranslation } from "react-i18next";
import { Search } from "@crate/ui/icons";

export function SearchNoResultsState() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-sm rounded-[12px] border border-accent-action/12 bg-text-primary/[0.035] px-6 py-10 text-center shadow-card">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-accent-action/15 bg-accent-action/8 text-text-accent">
        <Search size={18} />
      </div>
      <p className="mt-4 text-base font-semibold text-text-primary">
        {t("search.noMusicFound")}
      </p>
      <p className="mt-2 text-sm text-text-muted">{t("search.noMusicHint")}</p>
    </div>
  );
}
