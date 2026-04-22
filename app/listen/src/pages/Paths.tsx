import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Loader2, MapPin, Play, Route, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";

interface PathEndpoint {
  type: string;
  value: string;
  label: string;
}

interface PathSummary {
  id: number;
  name: string;
  origin: PathEndpoint;
  destination: PathEndpoint;
  waypoints: PathEndpoint[];
  step_count: number;
  track_count: number;
  created_at: string;
}

interface PathTrack {
  step: number;
  progress: number;
  track_id: number;
  storage_id?: string;
  title: string;
  artist: string;
  album?: string;
  album_id?: number;
  distance: number;
}

interface PathDetail extends Omit<PathSummary, "track_count"> {
  tracks: PathTrack[];
}

// ── Create Path Modal ─────────────────────────────────────────────

type EndpointType = "artist" | "genre" | "album" | "track";

interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
}

function EndpointPicker({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: SearchResult | null;
  onSelect: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const data = await api<{
        artists?: { id: number; name: string; slug?: string }[];
        albums?: { id: number; name: string; artist: string; slug?: string }[];
        tracks?: { id: number; title: string; artist: string }[];
      }>(`/api/search?q=${encodeURIComponent(q)}&limit=5`);

      const items: SearchResult[] = [];
      for (const a of data.artists?.slice(0, 3) ?? []) {
        items.push({ type: "artist", value: String(a.id), label: a.name });
      }
      for (const a of data.albums?.slice(0, 3) ?? []) {
        items.push({ type: "album", value: String(a.id), label: `${a.name} — ${a.artist}` });
      }
      for (const t of data.tracks?.slice(0, 3) ?? []) {
        items.push({ type: "track", value: String(t.id), label: `${t.title} — ${t.artist}` });
      }
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  if (selected) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-primary/60">{label}</div>
            <div className="text-sm font-medium text-primary">{selected.label}</div>
            <div className="text-[10px] text-primary/50">{selected.type}</div>
          </div>
          <button
            onClick={() => onSelect(null as unknown as SearchResult)}
            className="rounded-md p-1 text-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
        placeholder="Search artist, album, track..."
        className="h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-foreground placeholder:text-white/30 focus:border-primary/30 focus:outline-none"
      />
      {searching && <Loader2 size={14} className="mt-2 animate-spin text-primary" />}
      {results.length > 0 && (
        <div className="mt-1 space-y-0.5 rounded-lg border border-white/8 bg-black/30 p-1">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.value}`}
              onClick={() => { onSelect(r); setQuery(""); setResults([]); }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase text-white/40">{r.type}</span>
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePathPanel({ onCreated }: { onCreated: () => void }) {
  const [origin, setOrigin] = useState<SearchResult | null>(null);
  const [destination, setDestination] = useState<SearchResult | null>(null);
  const [steps, setSteps] = useState(20);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const canCreate = origin && destination && !creating;

  const create = async () => {
    if (!origin || !destination) return;
    setCreating(true);
    try {
      const result = await api<PathDetail>("/api/paths", "POST", {
        origin: { type: origin.type, value: origin.value },
        destination: { type: destination.type, value: destination.value },
        step_count: steps,
      });
      toast.success(`Created "${result.name}"`);
      onCreated();
      navigate(`/paths/${result.id}`);
    } catch {
      toast.error("Could not compute path — endpoints may lack audio analysis");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Route size={16} className="text-primary" />
        New Music Path
      </div>

      <EndpointPicker label="Origin" selected={origin} onSelect={setOrigin} />
      <EndpointPicker label="Destination" selected={destination} onSelect={setDestination} />

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Steps</div>
        <input
          type="range"
          min={5}
          max={50}
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="text-right text-[11px] tabular-nums text-white/40">{steps} tracks</div>
      </div>

      <button
        onClick={create}
        disabled={!canCreate}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-30"
      >
        {creating ? <Loader2 size={14} className="animate-spin" /> : <Route size={14} />}
        Compute Path
      </button>
    </div>
  );
}

// ── Path List ─────────────────────────────────────────────────────

function PathCard({
  path,
  onPlay,
  onDelete,
}: {
  path: PathSummary;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/paths/${path.id}`)}
      className="group cursor-pointer rounded-xl border border-white/6 bg-white/[0.02] p-4 transition hover:border-primary/20 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{path.name}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
            <MapPin size={10} className="text-primary/60" />
            <span>{path.origin.label}</span>
            <span className="text-white/15">→</span>
            <span>{path.destination.label}</span>
          </div>
          <div className="mt-1.5 text-[10px] text-white/30">
            {path.track_count} tracks · {new Date(path.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary transition hover:bg-primary/25"
          >
            <Play size={14} className="ml-0.5 fill-current" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/20 transition hover:bg-white/5 hover:text-white/50"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function Paths() {
  const { data: paths, refetch } = useApi<PathSummary[]>("/api/paths");
  const { playAll } = usePlayerActions();

  const playPath = async (pathId: number) => {
    try {
      const detail = await api<PathDetail>(`/api/paths/${pathId}`);
      const tracks: Track[] = detail.tracks.map((t) => ({
        id: t.storage_id || String(t.track_id),
        storageId: t.storage_id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumId: t.album_id,
        albumCover: t.album_id ? albumCoverApiUrl({ albumId: t.album_id }) : undefined,
        libraryTrackId: t.track_id,
      }));
      playAll(tracks, 0, { type: "playlist", name: detail.name, id: detail.id });
    } catch {
      toast.error("Failed to load path");
    }
  };

  const deletePath = async (pathId: number) => {
    try {
      await api(`/api/paths/${pathId}`, "DELETE");
      toast.success("Path deleted");
      refetch();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="animate-page-in space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <Route size={22} className="text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Music Paths</h1>
      </div>

      <CreatePathPanel onCreated={refetch} />

      {paths && paths.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/35">Your paths</div>
          {paths.map((p) => (
            <PathCard
              key={p.id}
              path={p}
              onPlay={() => void playPath(p.id)}
              onDelete={() => void deletePath(p.id)}
            />
          ))}
        </div>
      )}

      {paths && paths.length === 0 && (
        <div className="py-12 text-center text-sm text-white/25">
          No paths yet. Create one above to start exploring.
        </div>
      )}
    </div>
  );
}
