import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { CrateChip } from "@/components/ui/CrateBadge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  "flex h-10 min-w-[140px] max-w-[220px] items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs shadow-[0_18px_40px_rgba(0,0,0,0.2)] transition-colors hover:border-white/20 hover:bg-white/[0.07]";

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
            value ? "text-white" : "text-white/45",
            disabled && "cursor-not-allowed opacity-50",
            triggerClassName,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown size={12} className="ml-auto shrink-0 text-white/35" />
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
                  className="h-9 border-white/10 bg-white/[0.04] pl-8 text-xs"
                />
              </div>
            </div>
          ) : null}

          <div className="max-h-[220px] overflow-y-auto p-1">
            {allowClear ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white",
                  !value && "bg-primary/10 text-primary",
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
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white",
                    value === option.value && "bg-primary/10 text-primary",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.count != null ? <CrateChip className="text-[9px]">{option.count}</CrateChip> : null}
                </button>
              ))
            ) : (
              <div className="px-2 py-4 text-center text-xs text-white/40">{noMatchesLabel}</div>
            )}
          </div>
      </PopoverContent>
    </Popover>
  );
}
