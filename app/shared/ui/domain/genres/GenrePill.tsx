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
  const emphasis = percent != null ? Math.max(0.18, Math.min(0.5, percent / 100)) : 0.18;
  const content = (
    <>
      <span className="truncate">{item.name.toLowerCase()}</span>
      {percent != null ? (
        <span className="rounded-sm bg-black/25 px-1 py-0.5 text-[10px] font-semibold text-white/78">
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
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-white/80 transition-colors hover:border-white/25 hover:text-white",
          className,
        )}
        style={{
          borderColor: `rgba(255,255,255,${0.1 + emphasis * 0.45})`,
          backgroundColor: `rgba(255,255,255,${0.02 + emphasis * 0.14})`,
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-white/80",
        className,
      )}
      style={{
        borderColor: `rgba(255,255,255,${0.1 + emphasis * 0.45})`,
        backgroundColor: `rgba(255,255,255,${0.02 + emphasis * 0.14})`,
      }}
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
