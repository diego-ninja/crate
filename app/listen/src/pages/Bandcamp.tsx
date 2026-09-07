import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Loader2, Radar, RefreshCw } from "@crate/ui/icons";
import type { LucideIcon } from "@crate/ui/icons";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { BandcampCard } from "./BandcampCard";
import { BandcampListItem } from "./BandcampListItem";
import type {
  BandcampCollectionResponse,
  BandcampConnectionStatus,
  BandcampItem,
  BandcampRadarResponse,
  BandcampTaskResponse,
} from "./bandcamp-model";

export function Bandcamp() {
  const { t } = useTranslation();
  const status = useApi<BandcampConnectionStatus>("/api/bandcamp/me/status");
  const collection = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/collection",
  );
  const wishlist = useApi<BandcampCollectionResponse>(
    "/api/bandcamp/me/wishlist",
  );
  const radar = useApi<BandcampRadarResponse>("/api/bandcamp/me/radar");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    status.refetch();
    collection.refetch();
    wishlist.refetch();
    radar.refetch();
  }, [collection, radar, status, wishlist]);

  const stats = useMemo(
    () => [
      {
        label: "owned",
        labelText: t("bandcamp.stats.owned"),
        value: collection.data?.total ?? 0,
        icon: BandcampLogo,
      },
      {
        label: "wishlist",
        labelText: t("bandcamp.stats.wishlist"),
        value: wishlist.data?.total ?? 0,
        icon: Heart,
      },
      {
        label: "radar",
        labelText: t("bandcamp.stats.radar"),
        value: radar.data?.total ?? 0,
        icon: Radar,
      },
    ],
    [collection.data, radar.data, t, wishlist.data],
  );

  async function queueTask(path: string, busyKey: string, taskLabel: string) {
    setBusyAction(busyKey);
    try {
      const response = await api<BandcampTaskResponse>(path, "POST");
      toast.success(
        t("bandcamp.toasts.taskQueued", {
          task: taskLabel,
          taskId: response.task_id,
        }),
      );
      refreshAll();
    } catch (error) {
      toast.error((error as Error).message || t("bandcamp.toasts.queueFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function importItem(item: BandcampItem) {
    const itemId = item.bandcamp_item_id ?? item.id;
    if (!itemId) return;
    setBusyAction(`import:${item.id}`);
    try {
      const response = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/imports",
        "POST",
        { bandcamp_item_id: itemId, format: "flac" },
      );
      toast.success(
        t("bandcamp.toasts.importQueued", { taskId: response.task_id }),
      );
      refreshAll();
    } catch (error) {
      toast.error(
        (error as Error).message || t("bandcamp.toasts.importFailed"),
      );
    } finally {
      setBusyAction(null);
    }
  }

  const connected = status.data?.connected === true;
  const recentOwned = collection.data?.items.slice(0, 8) ?? [];
  const radarItems = radar.data?.items.slice(0, 8) ?? [];
  const wishlistItems = wishlist.data?.items.slice(0, 6) ?? [];
  const profileName =
    status.data?.display_name ||
    status.data?.username ||
    t("bandcamp.connection.accountFallback");

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-8 px-4 py-6 md:px-8">
      <section className="bandcamp-page-surface relative overflow-hidden rounded-[12px] border border-text-primary/8 p-6 md:p-8">
        <div className="bandcamp-page-sheen pointer-events-none absolute inset-y-0 right-0 w-1/2" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent-action/10 px-3 py-2 text-xs font-black uppercase tracking-[0.24em] text-accent-action">
              <BandcampLogo className=" size-3.5" />
              Bandcamp
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-tight text-text-primary md:text-6xl">
              {t("bandcamp.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-base text-text-secondary md:text-lg">
              {t("bandcamp.subtitle")}
            </p>
            <ConnectionLine
              connected={connected}
              loading={status.loading}
              profileName={profileName}
              error={status.data?.last_error}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!connected || busyAction !== null}
              onClick={() =>
                queueTask(
                  "/api/bandcamp/me/sync",
                  "sync",
                  t("bandcamp.tasks.sync"),
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent-action px-5 text-sm font-black text-accent-action-foreground transition hover:bg-accent-action/90 disabled:opacity-50"
            >
              {busyAction === "sync" ? (
                <Loader2 className=" size-4 animate-spin" />
              ) : (
                <RefreshCw className=" size-4" />
              )}
              {t("bandcamp.actions.sync")}
            </button>
            <button
              type="button"
              disabled={!connected || busyAction !== null}
              onClick={() =>
                queueTask(
                  "/api/bandcamp/me/radar/refresh",
                  "radar",
                  t("bandcamp.tasks.radar"),
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-full border border-text-primary/12 bg-text-primary/5 px-5 text-sm font-black text-text-primary transition hover:bg-text-primary/10 disabled:opacity-50"
            >
              <Radar className=" size-4" />
              {t("bandcamp.actions.refreshRadar")}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} label={stat.labelText} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Rail
          title={t("bandcamp.rails.radar.title")}
          subtitle={t("bandcamp.rails.radar.subtitle")}
        >
          <ItemGrid
            items={radarItems}
            busyAction={busyAction}
            onImport={importItem}
            empty={t("bandcamp.empty.radar")}
          />
        </Rail>
        <Rail
          title={t("bandcamp.rails.owned.title")}
          subtitle={t("bandcamp.rails.owned.subtitle")}
        >
          <ItemList
            items={recentOwned}
            busyAction={busyAction}
            onImport={importItem}
            empty={t("bandcamp.empty.owned")}
          />
        </Rail>
      </section>

      <Rail
        title={t("bandcamp.rails.wishlist.title")}
        subtitle={t("bandcamp.rails.wishlist.subtitle")}
      >
        <ItemGrid
          items={wishlistItems}
          busyAction={busyAction}
          onImport={importItem}
          empty={t("bandcamp.empty.wishlist")}
        />
      </Rail>
    </div>
  );
}

function ConnectionLine({
  connected,
  loading,
  profileName,
  error,
}: {
  connected: boolean;
  loading: boolean;
  profileName: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  if (loading && !connected) {
    return (
      <p className="mt-5 text-sm text-text-muted">
        {t("bandcamp.connection.checking")}
      </p>
    );
  }
  if (!connected) {
    return (
      <p className="mt-5 text-sm text-state-warning-text">
        {t("bandcamp.connection.notConnected")}
      </p>
    );
  }
  return (
    <p className="mt-5 text-sm text-text-secondary">
      {t("bandcamp.connection.connectedAs")}{" "}
      <span className="font-bold text-text-primary">{profileName}</span>
      {error ? (
        <span className="text-state-danger-text">
          {" · "}
          {t("bandcamp.connection.lastError", { error })}
        </span>
      ) : null}
    </p>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon | typeof BandcampLogo;
}) {
  return (
    <div className="rounded-[12px] border border-text-primary/8 bg-text-primary/[0.035] p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-[0.24em] text-text-muted">
          {label}
        </span>
        <Icon className=" size-4 text-accent-action" />
      </div>
      <div className="mt-5 text-4xl font-black text-text-primary">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Rail({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-text-primary/8 bg-surface-elevated/90 p-5">
      <div className="mb-5">
        <h2 className="text-2xl font-black text-text-primary">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function ItemGrid({
  items,
  busyAction,
  onImport,
  empty,
}: {
  items: BandcampItem[];
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  empty: string;
}) {
  if (!items.length) return <Empty label={empty} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <BandcampCard
          key={`${item.id}-${item.item_url}`}
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </div>
  );
}

function ItemList({
  items,
  busyAction,
  onImport,
  empty,
}: {
  items: BandcampItem[];
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  empty: string;
}) {
  if (!items.length) return <Empty label={empty} />;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <BandcampListItem
          key={`${item.id}-${item.item_url}`}
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-quiet bg-surface-canvas/16 p-6 text-sm text-text-muted">
      {label}
    </div>
  );
}
