import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";

export interface OpsSnapshotMetadata {
  scope: string;
  subject_key: string;
  version: number;
  built_at?: string | null;
  stale_after?: string | null;
  stale: boolean;
  generation_ms: number;
}

export interface OpsStatsSnapshot {
  artists: number;
  albums: number;
  tracks: number;
  total_size_gb: number;
  formats: Record<string, number>;
  last_scan: string | null;
  pending_imports: number;
  pending_tasks: number;
  total_duration_hours: number;
  avg_bitrate: number;
  top_genres: { name: string; count: number }[];
  recent_albums: {
    id?: number;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_slug?: string;
    name: string;
    display_name?: string;
    year: string | null;
    updated_at?: string;
  }[];
  analyzed_tracks: number;
  avg_album_duration_min?: number;
  avg_tracks_per_album?: number;
}

export interface OpsAnalyticsSnapshot {
  formats: Record<string, number>;
  decades: Record<string, number>;
  top_artists: { id?: number; slug?: string; name: string; albums: number }[];
  computing?: boolean;
}

export interface OpsLiveActivity {
  engine?: string;
  queue_breakdown: {
    running: { fast: number; default: number; heavy: number };
    pending: { fast: number; default: number; heavy: number };
  };
  db_heavy_gate: {
    active: number;
    pending: number;
    blocking: boolean;
  };
  running_tasks: {
    id: string;
    type: string;
    status?: string;
    pool?: string | null;
    progress: string;
    created_at?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
  }[];
  pending_tasks: {
    id: string;
    type: string;
    status?: string;
    pool?: string | null;
    progress: string;
    created_at?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
  }[];
  recent_tasks: { id: string; type: string; status: string; updated_at: string }[];
  worker_slots: { max: number; active: number };
  systems: {
    postgres: boolean;
    watcher: boolean;
  };
}

export interface AnalysisStatusSnapshot {
  total: number;
  analysis_done: number;
  analysis_pending: number;
  analysis_active: number;
  analysis_failed: number;
  bliss_done: number;
  bliss_pending: number;
  bliss_active: number;
  bliss_failed: number;
  fingerprint_done: number;
  fingerprint_pending: number;
  fingerprint_chromaprint: number;
  fingerprint_pcm: number;
  chromaprint_available: boolean;
  fingerprint_strategy: string;
  last_analyzed: {
    title?: string;
    artist?: string;
    album?: string;
    bpm?: number;
    audio_key?: string;
    energy?: number;
    danceability?: number;
    has_mood?: boolean;
    updated_at?: string;
  };
  last_bliss: {
    title?: string;
    artist?: string;
    album?: string;
    updated_at?: string;
  };
}

export interface OpsDomainEventPreview {
  id: string;
  event_type: string;
  scope: string;
  subject_key: string;
}

export interface OpsDomainEventRuntime {
  redis_connected: boolean;
  stream_key: string;
  consumer_group: string;
  latest_sequence: number;
  stream_length: number;
  pending: number;
  consumers: number;
  lag: number;
  last_delivered_id: string | null;
  recent_events: OpsDomainEventPreview[];
}

export interface OpsCacheInvalidationRuntime {
  redis_connected: boolean;
  events_key: string;
  latest_event_id: number;
  retained_events: number;
}

export interface OpsSseSurface {
  name: string;
  endpoint: string | null;
  channel: string;
  mode: string;
  description?: string | null;
}

export interface OpsEventingSnapshot {
  redis_connected: boolean;
  domain_events: OpsDomainEventRuntime;
  cache_invalidation: OpsCacheInvalidationRuntime;
  sse_surfaces: OpsSseSurface[];
}

export interface OpsSnapshotData {
  snapshot: OpsSnapshotMetadata;
  status: {
    scanning: boolean;
    last_scan: string | null;
    issue_count: number;
    progress?: unknown;
    pending_imports: number;
    running_tasks: number;
  };
  stats: OpsStatsSnapshot;
  analytics: OpsAnalyticsSnapshot;
  live: OpsLiveActivity;
  recent: {
    tasks: {
      id: string;
      type: string;
      status: string;
      created_at?: string;
      updated_at?: string;
    }[];
    pending_imports: number;
    last_scan: string | null;
  };
  analysis: AnalysisStatusSnapshot;
  health_counts: Record<string, number>;
  upcoming_shows: {
    artist_name?: string;
    venue?: string;
    city?: string;
    country?: string;
    date?: string;
    url?: string;
  }[];
  runtime: {
    active_users_5m: number;
    streams_3m: number;
  };
  eventing: OpsEventingSnapshot;
}

interface OpsSnapshotContextValue {
  data: OpsSnapshotData | null;
  loading: boolean;
  error: string | null;
  refresh: (fresh?: boolean) => Promise<void>;
}

const OpsSnapshotContext = createContext<OpsSnapshotContextValue | null>(null);

export function OpsSnapshotProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OpsSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const inflightRefreshRef = useRef<Promise<void> | null>(null);
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(async (fresh = false) => {
    const now = Date.now();
    if (fresh && now - lastRefreshAtRef.current < 1500) {
      return inflightRefreshRef.current ?? Promise.resolve();
    }
    if (inflightRefreshRef.current) {
      return inflightRefreshRef.current;
    }

    lastRefreshAtRef.current = now;
    if (!hasLoadedRef.current) setLoading(true);
    const request = (async () => {
      try {
        const query = fresh ? "?fresh=1" : "";
        const snapshot = await api<OpsSnapshotData>(`/api/admin/ops-snapshot${query}`);
        setData(snapshot);
        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load operational snapshot");
      } finally {
        setLoading(false);
        inflightRefreshRef.current = null;
      }
    })();
    inflightRefreshRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/ops-stream", { withCredentials: true });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as OpsSnapshotData;
          setData(payload);
          setError(null);
          setLoading(false);
          hasLoadedRef.current = true;
        } catch {
          // ignore malformed snapshots
        }
      };
      stream.onerror = () => {
        stream?.close();
        stream = null;
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    }

    function handleOnline() {
      void refresh(true);
    }

    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refresh]);

  const value = useMemo<OpsSnapshotContextValue>(() => ({
    data,
    loading,
    error,
    refresh,
  }), [data, error, loading, refresh]);

  return <OpsSnapshotContext.Provider value={value}>{children}</OpsSnapshotContext.Provider>;
}

export function useOpsSnapshot() {
  const context = useContext(OpsSnapshotContext);
  if (!context) {
    throw new Error("useOpsSnapshot must be used inside OpsSnapshotProvider");
  }
  return context;
}
