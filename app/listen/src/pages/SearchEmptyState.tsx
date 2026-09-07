import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "@crate/ui/icons";

export function SearchEmptyState({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useTranslation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = value.trim();
    if (query) onSearch(query);
  }

  return (
    <div className="mx-auto max-w-2xl rounded-[12px] border border-border-quiet bg-text-primary/[0.035] p-6 shadow-card sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-accent-action/15 bg-accent-action/8 text-text-accent">
          <Search size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {t("search.label")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("search.emptyPrompt")}
          </p>
        </div>
      </div>
      <form
        className="mt-5 flex flex-col gap-2 sm:flex-row"
        onSubmit={handleSubmit}
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="h-11 min-w-0 flex-1 rounded-md border border-text-primary/12 bg-surface-canvas/20 px-3 text-base text-text-primary outline-none placeholder:text-text-muted focus-visible:border-accent-action/50"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent-action px-4 text-sm font-medium text-accent-action-foreground shadow-action transition-colors hover:bg-accent-action/90 disabled:pointer-events-none disabled:opacity-50"
        >
          <Search size={17} />
          {t("search.label")}
        </button>
      </form>
    </div>
  );
}
