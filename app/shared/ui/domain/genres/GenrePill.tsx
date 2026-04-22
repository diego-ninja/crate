import { cn } from "@crate/ui/lib/cn";

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
  className,
}: {
  item: GenreProfileItem;
  onClick?: () => void;
  className?: string;
}) {
  const percent = resolveGenrePercent(item);
  const content = (
    <>
      <span className="truncate">{item.name.toLowerCase()}</span>
      {percent != null ? (
        <span className="rounded-sm border border-[var(--active-border)] bg-[var(--active-bg-strong)] px-1 py-0.5 text-[10px] font-semibold text-[var(--active-text)]">
          {percent}%
        </span>
      ) : null}
    </>
  );

  const titleParts = [item.name];
  if (percent != null) titleParts.push(`${percent}%`);
  if (item.source) titleParts.push(item.source);
  const title = titleParts.join(" · ");

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] px-2 py-1 text-[11px] text-[var(--active-text)] transition-colors hover:border-[var(--pill-active-border)] hover:bg-[var(--pill-active-bg)]",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] px-2 py-1 text-[11px] text-[var(--active-text)]",
        className,
      )}
    >
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
    <div className={cn("flex flex-wrap gap-1.5", className)}>
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
