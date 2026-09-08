import { useRef } from "react";
import { CRATE_ICON_SIZE, Loader2, Search, X } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  inputClassName?: string;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  loading = false,
  disabled = false,
  placeholder = "Search…",
  autoFocus = false,
  onFocus,
  onBlur,
  className,
  inputClassName,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && onSubmit) {
      event.preventDefault();
      onSubmit(value);
    }
  }

  function handleClear() {
    onChange("");
    inputRef.current?.focus();
  }

  return (
    <div
      className={cn(
        "relative flex items-center rounded-xl border border-text-primary/8 bg-surface-canvas/25 shadow-sm transition-[background-color,border-color,box-shadow]",
        "focus-within:border-accent-action/25 focus-within:bg-surface-canvas/40 focus-within:shadow-focus",
        className,
      )}
    >
      <Search
        size={CRATE_ICON_SIZE.md}
        className="pointer-events-none absolute left-4 shrink-0 text-text-primary/40"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="Search"
        className={cn(
          "h-12 w-full rounded-xl border-0 bg-transparent py-0 pl-12 pr-11 text-[0.9375rem] text-text-primary outline-none",
          "placeholder:text-text-primary/40",
          disabled && "cursor-not-allowed opacity-60",
          inputClassName,
        )}
      />
      <div className="pointer-events-none absolute right-4 flex h-full items-center justify-center">
        {loading ? (
          <Loader2
            size={CRATE_ICON_SIZE.sm}
            className="pointer-events-auto animate-spin text-text-primary/40"
            aria-hidden="true"
          />
        ) : value ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear search"
            className="pointer-events-auto flex size-9 items-center justify-center text-text-primary/30 transition-colors hover:text-text-primary/65 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={CRATE_ICON_SIZE.lg} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
