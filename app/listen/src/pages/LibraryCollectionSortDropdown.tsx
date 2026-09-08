import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "@crate/ui/icons";

import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import type { CollectionSortOption } from "./library-collection-model";

export function CollectionSortDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: CollectionSortOption<T>[];
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useDismissibleLayer({
    active: open,
    refs: [rootRef],
    onDismiss: () => setOpen(false),
  });

  if (!selected) return null;
  const selectedLabel = t(selected.labelKey);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("library.sort.selectedAria", {
          label,
          value: selectedLabel,
        })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={[
          "listen-glass-panel flex h-10 min-w-[172px] items-center justify-between gap-3 rounded-lg border border-border-quiet/10 px-4 text-sm font-semibold text-text-primary transition-[border-color,box-shadow,filter,transform] hover:-translate-y-px hover:border-accent-action/40 hover:shadow-accent-action-soft focus-visible:border-accent-action/70 focus-visible:outline-none focus-visible:shadow-accent-action",
          open ? "border-accent-action/45 shadow-accent-action" : "",
        ].join(" ")}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={[
            "shrink-0 text-text-primary/55 transition-transform",
            open ? "rotate-180 text-accent-action" : "",
          ].join(" ")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="listen-glass-panel absolute right-0 top-full z-app-dropdown mt-2 w-48 overflow-hidden rounded-[12px] border border-border-quiet/10 p-1 shadow-menu animate-pop-in"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={[
                  "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-[background-color,color,filter]",
                  isSelected
                    ? "bg-accent-action/14 text-accent-action drop-shadow-accent-action"
                    : "text-text-primary hover:bg-text-primary/7 hover:text-accent-action hover:drop-shadow-accent-action-soft",
                ].join(" ")}
              >
                <span>{t(option.labelKey)}</span>
                {isSelected ? <Check size={16} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
