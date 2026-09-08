import { useCallback, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  Radar,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface BandcampConnectionStatus {
  connected: boolean;
  status: string;
  bridge_enabled: boolean;
  username?: string | null;
  fan_id?: number | null;
  display_name?: string | null;
  image_url?: string | null;
  connection_method?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
}

interface BandcampCollectionResponse {
  items: BandcampItem[];
  total: number;
}

interface BandcampRadarResponse {
  items: BandcampRadarItem[];
  total: number;
}

interface BandcampImportResponse {
  imports: BandcampImport[];
  total: number;
}

interface BandcampMatchesResponse {
  items: BandcampMatch[];
  total: number;
}

interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

interface BandcampItem {
  id: number;
  bandcamp_item_id?: number | null;
  bandcamp_item_type?: string | null;
  artist_name?: string | null;
  album_title?: string | null;
  track_title?: string | null;
  item_url?: string | null;
  cover_url?: string | null;
  owned?: boolean | null;
  downloadable?: boolean | null;
  latest_import_status?: string | null;
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
}

interface BandcampRadarItem extends BandcampItem {
  score?: number | null;
  source?: string | null;
  status?: string | null;
}

interface BandcampImport extends BandcampItem {
  status?: string | null;
  requested_format?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

interface BandcampMatch extends BandcampItem {
  id: number;
  entity_type: "artist" | "album" | "track";
  entity_uid: string;
  entity_name?: string | null;
  entity_artist?: string | null;
  confidence: number;
  status: "candidate" | "confirmed" | "rejected";
  source?: string | null;
}

export function Bandcamp() {
  const status = useApi<BandcampConnectionStatus>("/api/bandcamp/me/status");
  const collection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/collection",
  );
  const wishlist = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/wishlist",
  );
  const following = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/following",
  );
  const radar = useApi<BandcampRadarResponse>("/api/bandcamp/me/radar");
  const imports = useApi<BandcampImportResponse>("/api/bandcamp/me/imports");
  const adminCollection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/admin/collection?relation_type=collection&limit=50",
  );
  const matches = useApi<BandcampMatchesResponse>(
    "/api/bandcamp/admin/matches?limit=100",
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    status.refetch();
    collection.refetch();
    wishlist.refetch();
    following.refetch();
    radar.refetch();
    imports.refetch();
    adminCollection.refetch();
    matches.refetch();
  }, [
    adminCollection,
    collection,
    following,
    imports,
    matches,
    radar,
    status,
    wishlist,
  ]);

  const counts = useMemo(
    () => [
      {
        label: "Collection",
        value: collection.data?.total ?? 0,
        icon: Download,
      },
      { label: "Wishlist", value: wishlist.data?.total ?? 0, icon: Heart },
      {
        label: "Following",
        value: following.data?.total ?? 0,
        icon: BandcampLogo,
      },
      { label: "Radar", value: radar.data?.total ?? 0, icon: Radar },
    ],
    [collection.data, following.data, radar.data, wishlist.data],
  );

  async function queueTask(path: string, label: string) {
    setBusyAction(label);
    try {
      const response = await api<BandcampTaskResponse>(path, "POST");
      toast.success(`${label} queued (${response.task_id})`);
      refreshAll();
    } catch (error) {
      toast.error((error as Error).message || `Failed to queue ${label}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function updateMatch(matchId: number, action: "confirm" | "reject") {
    const label = `${action}:${matchId}`;
    setBusyAction(label);
    try {
      await api(`/api/bandcamp/admin/matches/${matchId}/${action}`, "POST");
      toast.success(
        action === "confirm" ? "Match confirmed" : "Match rejected",
      );
      matches.refetch();
    } catch (error) {
      toast.error(
        (error as Error).message || "Failed to update Bandcamp match",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const connected = status.data?.connected === true;
  const latestImports = imports.data?.imports.slice(0, 5) ?? [];
  const latestRadar = radar.data?.items.slice(0, 5) ?? [];
  const syncedPurchases = adminCollection.data?.items.slice(0, 8) ?? [];
  const candidateMatches =
    matches.data?.items.filter((match) => match.status === "candidate") ?? [];
  const confirmedMatches =
    matches.data?.items
      .filter((match) => match.status === "confirmed")
      .slice(0, 8) ?? [];

  return (
    <main className="space-y-8">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_36%),linear-gradient(135deg,rgba(18,18,24,0.96),rgba(10,10,14,0.98))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04))]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <CratePill icon={BandcampLogo}>Bandcamp bridge</CratePill>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white">
                Support layer for the collection
              </h1>
              <p className="mt-2 text-base text-slate-400">
                Connect purchases, match Bandcamp URLs to Crate entities and
                import owned releases without making the library messy.
              </p>
            </div>
            <ConnectionStatus status={status.data} loading={status.loading} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() =>
                queueTask("/api/bandcamp/me/sync", "Bandcamp sync")
              }
              disabled={!connected || busyAction !== null}
              className="gap-2 rounded-full"
            >
              {busyAction === "Bandcamp sync" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync collection
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                queueTask("/api/bandcamp/me/radar/refresh", "Bandcamp Radar")
              }
              disabled={!connected || busyAction !== null}
              className="gap-2 rounded-full"
            >
              <Radar className="h-4 w-4" />
              Refresh Radar
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                queueTask(
                  "/api/bandcamp/admin/backfill-urls?limit=250&public_search=true",
                  "Bandcamp URL backfill",
                )
              }
              disabled={busyAction !== null}
              className="gap-2 rounded-full"
            >
              {busyAction === "Bandcamp URL backfill" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              Backfill URLs
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {counts.map((count) => (
          <MetricCard
            key={count.label}
            label={count.label}
            value={count.value}
            icon={count.icon}
          />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <Panel
          title="Match candidates"
          eyebrow={`${candidateMatches.length} pending`}
        >
          {candidateMatches.length ? (
            <div className="space-y-3">
              {candidateMatches.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  busyAction={busyAction}
                  onConfirm={() => updateMatch(match.id, "confirm")}
                  onReject={() => updateMatch(match.id, "reject")}
                />
              ))}
            </div>
          ) : (
            <EmptyState label="No Bandcamp match candidates pending." />
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Radar" eyebrow={`${latestRadar.length} visible`}>
            <CompactItemList
              items={latestRadar}
              empty="No Radar candidates yet."
            />
          </Panel>
          <Panel
            title="Recent imports"
            eyebrow={`${imports.data?.total ?? 0} total`}
          >
            <CompactImportList imports={latestImports} />
          </Panel>
          <Panel
            title="Synced purchases"
            eyebrow={`${adminCollection.data?.total ?? 0} across users`}
          >
            <AdminCollectionList items={syncedPurchases} />
          </Panel>
        </div>
      </section>

      <Panel
        title="Confirmed links"
        eyebrow={`${confirmedMatches.length} recent`}
      >
        {confirmedMatches.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {confirmedMatches.map((match) => (
              <ConfirmedMatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <EmptyState label="Confirmed Bandcamp links will appear here." />
        )}
      </Panel>
    </main>
  );
}

function ConnectionStatus({
  status,
  loading,
}: {
  status: BandcampConnectionStatus | null;
  loading: boolean;
}) {
  if (loading && !status) {
    return <Badge variant="outline">Checking connection...</Badge>;
  }
  if (!status?.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
          Not connected
        </Badge>
        <span className="text-sm text-slate-500">
          Connect from Listen Settings before syncing purchases.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
        Connected
      </Badge>
      <span className="text-sm text-slate-300">
        {status.display_name || status.username || "Bandcamp fan"}
      </span>
      {status.connection_method ? (
        <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
          {status.connection_method}
        </span>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon | typeof BandcampLogo;
}) {
  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">
          {label}
        </span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-5 text-4xl font-black text-white">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-white/8 bg-[#121218]/88 p-5 shadow-[0_18px_56px_rgba(0,0,0,0.28)]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xl font-black text-white">{title}</h2>
        <span className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
          {eyebrow}
        </span>
      </div>
      {children}
    </section>
  );
}

function MatchRow({
  match,
  busyAction,
  onConfirm,
  onReject,
}: {
  match: BandcampMatch;
  busyAction: string | null;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const title = itemTitle(match);
  const subtitle = [match.artist_name, match.album_title || match.track_title]
    .filter(Boolean)
    .join(" · ");
  const entity = [match.entity_artist, match.entity_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="grid gap-4 rounded-2xl border border-white/8 bg-black/18 p-4 md:grid-cols-[56px_minmax(0,1fr)_auto] md:items-center">
      <ItemCover item={match} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{match.entity_type}</Badge>
          <Badge className="bg-cyan-400/10 text-cyan-200">
            {Math.round((match.confidence || 0) * 100)}%
          </Badge>
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {match.source || "sync"}
          </span>
        </div>
        <h3 className="mt-2 truncate text-base font-bold text-white">
          {entity}
        </h3>
        <p className="truncate text-sm text-slate-400">{title}</p>
        {subtitle ? (
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {match.item_url ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 rounded-full"
            onClick={() =>
              window.open(match.item_url || "", "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </Button>
        ) : null}
        <Button
          size="sm"
          className="gap-2 rounded-full"
          disabled={busyAction !== null}
          onClick={onConfirm}
        >
          {busyAction === `confirm:${match.id}` ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Confirm
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-full"
          disabled={busyAction !== null}
          onClick={onReject}
        >
          <XCircle className="h-4 w-4" />
          Reject
        </Button>
      </div>
    </article>
  );
}

function ConfirmedMatchCard({ match }: { match: BandcampMatch }) {
  return (
    <button
      type="button"
      className="group min-w-0 rounded-2xl border border-white/8 bg-black/18 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
      onClick={() =>
        match.item_url &&
        window.open(match.item_url, "_blank", "noopener,noreferrer")
      }
    >
      <ItemCover item={match} large />
      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{match.entity_type}</Badge>
          <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:text-primary" />
        </div>
        <h3 className="mt-2 truncate text-sm font-bold text-white">
          {match.entity_name || itemTitle(match)}
        </h3>
        <p className="truncate text-xs text-slate-500">{itemTitle(match)}</p>
      </div>
    </button>
  );
}

function CompactItemList({
  items,
  empty,
}: {
  items: BandcampItem[];
  empty: string;
}) {
  if (!items.length) return <EmptyState label={empty} />;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={`${item.id}-${item.item_url}`}
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl border border-white/6 bg-black/16 p-3 text-left transition hover:border-primary/35"
          onClick={() =>
            item.item_url &&
            window.open(item.item_url, "_blank", "noopener,noreferrer")
          }
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-white">
              {itemTitle(item)}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {item.artist_name}
            </p>
          </div>
          <ExternalLink className="h-4 w-4 text-slate-600" />
        </button>
      ))}
    </div>
  );
}

function CompactImportList({ imports }: { imports: BandcampImport[] }) {
  if (!imports.length) return <EmptyState label="No Bandcamp imports yet." />;
  return (
    <div className="space-y-3">
      {imports.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-2xl border border-white/6 bg-black/16 p-3"
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-white">
              {itemTitle(item)}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {item.requested_format || "flac"} · {item.status || "queued"}
            </p>
          </div>
          <Badge className={cn("capitalize", importStatusClass(item.status))}>
            {item.status || "queued"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function AdminCollectionList({ items }: { items: BandcampItem[] }) {
  if (!items.length) {
    return <EmptyState label="No Bandcamp purchases synced yet." />;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={`${item.user_email}-${item.id}-${item.item_url}`}
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl border border-white/6 bg-black/16 p-3 text-left transition hover:border-primary/35"
          onClick={() =>
            item.item_url &&
            window.open(item.item_url, "_blank", "noopener,noreferrer")
          }
        >
          <ItemCover item={item} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-white">
              {itemTitle(item)}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {item.artist_name} ·{" "}
              {item.user_name || item.user_username || item.user_email}
            </p>
          </div>
          {item.latest_import_status ? (
            <Badge
              className={cn(
                "capitalize",
                importStatusClass(item.latest_import_status),
              )}
            >
              {item.latest_import_status}
            </Badge>
          ) : (
            <Badge variant="outline">synced</Badge>
          )}
        </button>
      ))}
    </div>
  );
}

function ItemCover({
  item,
  large = false,
}: {
  item: BandcampItem;
  large?: boolean;
}) {
  const title = itemTitle(item);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-white/6",
        large ? "aspect-square w-full" : "h-14 w-14",
      )}
    >
      {item.cover_url ? (
        <img
          src={item.cover_url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="px-2 text-center text-xs font-black text-slate-500">
          {title.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/14 p-6 text-sm text-slate-500">
      {label}
    </div>
  );
}

function itemTitle(item: BandcampItem) {
  return (
    item.album_title || item.track_title || item.artist_name || "Bandcamp item"
  );
}

function importStatusClass(status?: string | null) {
  if (status === "completed") return "bg-emerald-400/10 text-emerald-200";
  if (status === "failed") return "bg-red-400/10 text-red-200";
  if (status === "running") return "bg-cyan-400/10 text-cyan-200";
  return "bg-white/10 text-slate-300";
}
