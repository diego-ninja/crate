import { useTranslation } from "react-i18next";
import { Search } from "@crate/ui/icons";

export function SearchErrorState({
  query,
  message,
}: {
  query: string;
  message: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">
        {t("search.resultsFor", { query })}
      </h1>
      <div className="mx-auto max-w-sm rounded-[12px] border border-state-warning/12 bg-text-primary/[0.035] px-6 py-10 text-center shadow-card">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-state-warning/15 bg-state-warning/8 text-state-warning-text">
          <Search size={18} />
        </div>
        <p className="mt-4 text-base font-semibold text-text-primary">
          {t("search.unavailable")}
        </p>
        <p className="mt-2 text-sm text-text-muted">{message}</p>
      </div>
    </div>
  );
}
