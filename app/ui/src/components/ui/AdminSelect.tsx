import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { Input } from "@crate/ui/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@crate/ui/shadcn/popover";
import { cn } from "@/lib/utils";

export interface AdminSelectOption {
  value: string;
  label: string;
  count?: number | string | null;
  searchText?: string;
}

interface AdminSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  placeholder: string;
  allowClear?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
}

const DEFAULT_TRIGGER_CLASS =
  "flex h-11 min-w-[140px] max-w-[220px] items-center gap-2 rounded-md border border-[var(--idle-border)] bg-black/25 px-4 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm transition-[background-color,border-color,box-shadow] hover:border-[var(--hover-border)] hover:bg-black/35";

export function AdminSelect({
  value,
  onChange,
  options,
  placeholder,
  allowClear = true,
  searchable = false,
  searchPlaceholder = "Search...",
  noMatchesLabel = "No matches",
  triggerClassName,
  menuClassName,
  disabled = false,
}: AdminSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, search]);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            DEFAULT_TRIGGER_CLASS,
            value ? "text-white" : "text-white/40",
            disabled && "cursor-not-allowed opacity-50",
            triggerClassName,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown size={14} className="ml-auto shrink-0 text-white/35" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        layer="dropdown"
        sideOffset={8}
        onOpenAutoFocus={(event) => {
          if (searchable) return;
          event.preventDefault();
        }}
        className={cn("w-[240px] overflow-hidden p-2", menuClassName)}
      >
          {searchable ? (
            <div className="border-b border-white/5 px-1 pb-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                  className="h-10 border-white/10 bg-black/25 pl-9 text-sm"
                />
              </div>
            </div>
          ) : null}

          <div className="max-h-[220px] space-y-1 overflow-y-auto p-1">
            {allowClear ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  !value
                    ? "border-[var(--active-border)] bg-[var(--active-bg)] text-primary"
                    : "border-transparent text-[var(--idle-text)] hover:border-[var(--hover-border)] hover:bg-[var(--hover-bg)] hover:text-foreground",
                )}
              >
                <span>{placeholder}</span>
                {!value ? <CrateChip active>Default</CrateChip> : null}
              </button>
            ) : null}

            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    value === option.value
                      ? "border-[var(--active-border)] bg-[var(--active-bg)] text-primary"
                      : "border-transparent text-[var(--idle-text)] hover:border-[var(--hover-border)] hover:bg-[var(--hover-bg)] hover:text-foreground",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.count != null ? <CrateChip className="text-[10px]">{option.count}</CrateChip> : null}
                </button>
              ))
            ) : (
              <div className="px-2 py-4 text-center text-sm text-[var(--idle-text-subtle)]">{noMatchesLabel}</div>
            )}
          </div>
      </PopoverContent>
    </Popover>
  );
}
