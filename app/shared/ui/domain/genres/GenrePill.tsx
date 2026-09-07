import { cn } from "@crate/ui/lib/cn";
import { X } from "@crate/ui/icons";

export interface GenreProfileItem {
  name: string;
  slug?: string | null;
  source?: string | null;
  weight?: number | null;
  share?: number | null;
  percent?: number | null;
}

export function resolveGenrePercent(item: GenreProfileItem) {
  if (typeof item.percent === "number") {
    return item.percent;
  }
  if (typeof item.share === "number") {
    return Math.round(item.share * 100);
  }
  return null;
}

export function GenrePill({
  item,
  onClick,
  onRemove,
  removeLabel,
  className,
}: {
  item: GenreProfileItem;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const percent = resolveGenrePercent(item);
  const content = (
    <>
      <span className="min-w-0 truncate">{item.name.toLowerCase()}</span>
      {percent != null ? (
        <span className="shrink-0 rounded-sm border border-[var(--active-border)] bg-[var(--active-bg-strong)] px-1 py-0.5 text-xs font-semibold text-[var(--active-text)]">
          {percent}%
        </span>
      ) : null}
    </>
  );

  const titleParts = [item.name];
  if (percent != null) titleParts.push(`${percent}%`);
  if (item.source) titleParts.push(item.source);
  const title = titleParts.join(" · ");
  const pillClassName =
    "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] px-2 py-1 text-xs text-[var(--active-text)]";

  if (onRemove) {
    return (
      <span className={cn(pillClassName, "pr-1", className)} title={title}>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-[var(--active-text)]"
          >
            {content}
          </button>
        ) : (
          content
        )}
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${item.name}`}
          onClick={onRemove}
          className="shrink-0 rounded-full p-0.5 text-[var(--active-text)]/70 transition-colors hover:bg-[var(--pill-active-bg)] hover:text-[var(--active-text)]"
        >
          <X size={12} />
        </button>
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          pillClassName,
          "transition-colors hover:border-[var(--pill-active-border)] hover:bg-[var(--pill-active-bg)]",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title} className={cn(pillClassName, className)}>
      {content}
    </span>
  );
}

export function GenrePillRow({
  items,
  max = 6,
  onSelect,
  className,
}: {
  items: GenreProfileItem[];
  max?: number;
  onSelect?: (item: GenreProfileItem) => void;
  className?: string;
}) {
  if (!items.length) return null;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden",
        className,
      )}
    >
      {items.slice(0, max).map((item) => (
        <GenrePill
          key={`${item.slug ?? item.name}-${item.source ?? "genre"}`}
          item={item}
          onClick={onSelect ? () => onSelect(item) : undefined}
        />
      ))}
    </div>
  );
}
