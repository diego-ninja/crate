import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Disc, Music, Search, User } from "@crate/ui/icons";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

import type {
  TopBarSearchRecentEntry,
  TopBarSearchItem,
} from "./topbar-search-model";

export function SearchResultThumb({ item }: { item: TopBarSearchItem }) {
  if (item.imageUrl) {
    return (
      <CrateImage
        src={item.imageUrl}
        alt=""
        className={[
          "h-8 w-8 shrink-0 bg-text-primary/5 object-cover",
          item.type === "artist" ? "rounded-full" : "rounded",
        ].join(" ")}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (item.type === "artist") {
    return (
      <User
        size={CRATE_ICON_SIZE.md}
        className=" size-8 shrink-0 rounded-full bg-text-primary/5 p-1.5 text-text-primary/30"
      />
    );
  }
  if (item.type === "album") {
    return (
      <Disc
        size={CRATE_ICON_SIZE.md}
        className=" size-8 shrink-0 rounded bg-text-primary/5 p-1.5 text-text-primary/30"
      />
    );
  }
  return (
    <Music
      size={CRATE_ICON_SIZE.md}
      className=" size-8 shrink-0 rounded bg-text-primary/5 p-1.5 text-text-primary/30"
    />
  );
}

export function TopBarSearchDropdown({
  dropdownRef,
  dropdownStyle,
  visibility,
  results,
  recents,
  activeIdx,
  trimmedQuery,
  searchError,
  onSelectItem,
  onSelectRecent,
  onSeeAllResults,
}: {
  dropdownRef: { current: HTMLDivElement | null };
  dropdownStyle: { left: number; top: number; width: number };
  visibility: {
    showResults: boolean;
    showRecents: boolean;
    showSearchError: boolean;
    showEmptyResults: boolean;
  };
  results: TopBarSearchItem[];
  recents: TopBarSearchRecentEntry[];
  activeIdx: number;
  trimmedQuery: string;
  searchError: string | null;
  onSelectItem: (item: TopBarSearchItem) => Promise<void>;
  onSelectRecent: (recent: TopBarSearchRecentEntry) => void;
  onSeeAllResults: () => void;
}) {
  const { t } = useTranslation();
  const { showResults, showRecents, showSearchError, showEmptyResults } =
    visibility;

  return createPortal(
    <AppPopover
      ref={dropdownRef}
      className={cn(
        "listen-glass-panel fixed max-h-80 overflow-y-auto rounded-[12px] py-1",
        showRecents ? "max-h-none" : undefined,
      )}
      style={dropdownStyle}
    >
      {showResults ? (
        <>
          {results.map((item, index) => (
            <button
              key={[
                item.type,
                item.navigateTo ?? item.label,
                item.sublabel ?? "",
                item.origin ?? "local",
              ].join(":")}
              onClick={() => void onSelectItem(item)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                index === activeIdx
                  ? "bg-text-primary/10"
                  : "hover:bg-text-primary/5",
              )}
            >
              <SearchResultThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] text-text-primary/80">
                  {item.label}
                </p>
                {item.sublabel ? (
                  <p className="truncate text-xs text-text-primary/40">
                    {item.sublabel}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs">
                {item.origin === "remote" ? (
                  <span className="rounded-full border border-accent-action/15 bg-accent-action/8 px-1.5 py-0.5 text-accent-action/80">
                    {item.nodeName || t("search.remoteSource")}
                  </span>
                ) : null}
                <span className="capitalize text-text-primary/20">
                  {t("search.resultType." + item.type)}
                </span>
              </div>
            </button>
          ))}
          {showSearchError ? (
            <SearchMessage
              iconClassName="border-state-warning/15 bg-state-warning/8 text-state-warning"
              title={t("search.unavailableTitle")}
              message={searchError}
            />
          ) : null}
          {showEmptyResults ? (
            <SearchMessage
              iconClassName="border-accent-action/15 bg-accent-action/8 text-accent-action"
              title={t("search.noMusicTitle")}
              message={t("search.noMusicSubtitle")}
            />
          ) : null}
          {trimmedQuery && !showSearchError ? (
            <button
              onClick={onSeeAllResults}
              className="mt-1 w-full border-t border-text-primary/5 px-3 py-2 text-center text-xs text-accent-action transition-colors hover:bg-text-primary/5"
            >
              {t("search.seeAllResults", { query: trimmedQuery })}
            </button>
          ) : null}
        </>
      ) : null}
      {showRecents ? (
        <>
          <p className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("search.recent")}
          </p>
          {recents.map((recent, index) => (
            <button
              key={[
                recent.type ?? "query",
                recent.navigateTo ?? recent.label,
                recent.origin ?? "local",
              ].join(":")}
              onClick={() => onSelectRecent(recent)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                index === activeIdx
                  ? "bg-text-primary/10"
                  : "hover:bg-text-primary/5",
              )}
            >
              <Search
                size={CRATE_ICON_SIZE.xs}
                className="shrink-0 text-text-primary/20"
              />
              <span className="truncate text-[0.8125rem] text-text-primary/60">
                {recent.label}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </AppPopover>,
    document.body,
  );
}

function SearchMessage({
  iconClassName,
  title,
  message,
}: {
  iconClassName: string;
  title: string;
  message: string | null;
}) {
  return (
    <div className="px-4 py-5 text-center">
      <div
        className={cn(
          "mx-auto flex h-10 w-10 items-center justify-center rounded-full border",
          iconClassName,
        )}
      >
        <Search size={CRATE_ICON_SIZE.md} />
      </div>
      <p className="mt-3 text-sm font-semibold text-text-primary/86">{title}</p>
      <p className="mt-1 text-xs text-text-primary/45">{message}</p>
    </div>
  );
}
