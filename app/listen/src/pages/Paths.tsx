import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Loader2, MapPin, Music, Play, Route, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

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
  entity_uid?: string;
  title: string;
  artist: string;
  artist_entity_uid?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  distance: number;
}

interface PathDetail extends Omit<PathSummary, "track_count"> {
  tracks: PathTrack[];
}

// ── Endpoint picker types ─────────────────────────────────────────

type EndpointType = "artist" | "genre" | "album" | "track";

interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  albumId?: number;
  albumEntityUid?: string;
}

// ── Endpoint panel ────────────────────────────────────────────────

function EndpointPanel({
  side,
  selected,
  onSelect,
}: {
  side: "origin" | "destination";
  selected: SearchResult | null;
  onSelect: (result: SearchResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const [searchData, genresData] = await Promise.all([
        api<{
          artists?: { id: number; entity_uid?: string; name: string; slug?: string }[];
          albums?: { id: number; entity_uid?: string; name: string; artist: string; slug?: string; album_id?: number; artist_entity_uid?: string }[];
          tracks?: { id: number; entity_uid?: string; title: string; artist: string; album_id?: number; album_entity_uid?: string; artist_id?: number; artist_entity_uid?: string; artist_slug?: string }[];
        }>(`/api/search?q=${encodeURIComponent(q)}&limit=5`),
        api<{ slug: string; name: string }[]>("/api/genres"),
      ]);

      const items: SearchResult[] = [];
      const qLower = q.toLowerCase();
      for (const g of genresData.filter((g) => g.name.toLowerCase().includes(qLower)).slice(0, 3)) {
        items.push({ type: "genre", value: g.slug, label: g.name });
      }
      for (const a of searchData.artists?.slice(0, 3) ?? []) {
        items.push({
          type: "artist", value: a.entity_uid || String(a.id), label: a.name,
          artistId: a.id, artistEntityUid: a.entity_uid, artistSlug: a.slug,
          imageUrl: artistPhotoApiUrl({ artistId: a.id, artistEntityUid: a.entity_uid, artistSlug: a.slug, artistName: a.name }),
        });
      }
      for (const a of searchData.albums?.slice(0, 3) ?? []) {
        items.push({
          type: "album", value: a.entity_uid || String(a.album_id ?? a.id ?? 0), label: `${a.name} — ${a.artist}`,
          albumId: a.album_id ?? a.id,
          albumEntityUid: a.entity_uid,
          artistEntityUid: a.artist_entity_uid,
          imageUrl: albumCoverApiUrl({
            albumId: a.album_id ?? a.id,
            albumEntityUid: a.entity_uid,
            artistEntityUid: a.artist_entity_uid,
            albumName: a.name,
            artistName: a.artist,
          }),
        });
      }
      for (const t of searchData.tracks?.slice(0, 2) ?? []) {
        items.push({
          type: "track", value: t.entity_uid || String(t.id), label: `${t.title} — ${t.artist}`,
          albumId: t.album_id,
          albumEntityUid: t.album_entity_uid,
          artistId: t.artist_id,
          artistEntityUid: t.artist_entity_uid,
          imageUrl: t.album_id || t.album_entity_uid
            ? albumCoverApiUrl({ albumId: t.album_id, albumEntityUid: t.album_entity_uid })
            : undefined,
        });
      }
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const coverUrl = selected?.imageUrl;
  const label = side === "origin" ? "From" : "To";

  return (
    <div className={`relative flex-1 overflow-hidden rounded-2xl border transition-colors ${
      selected ? "border-primary/30 bg-primary/5" : "border-white/8 bg-white/[0.02]"
    }`}>
      {/* Background cover */}
      {coverUrl && (
        <div className="absolute inset-0">
          <img src={coverUrl} alt="" className="h-full w-full object-cover opacity-20 blur-sm" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/70 to-black/50" />
        </div>
      )}

      <div className="relative p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/60">
          <MapPin size={10} className="mr-1 inline" />
          {label}
        </div>

        {selected ? (
          <div>
            {coverUrl && (
              <div className="mb-3 h-24 w-24 overflow-hidden rounded-xl bg-white/5 shadow-lg">
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="text-lg font-bold text-foreground">{selected.label}</div>
            <div className="mt-0.5 text-[11px] text-primary/70">{selected.type}</div>
            <button
              onClick={() => { onSelect(null); setQuery(""); setResults([]); }}
              className="mt-3 text-[11px] text-white/40 underline-offset-2 hover:text-white/60 hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
              placeholder="Search genre, artist, album..."
              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-foreground placeholder:text-white/25 focus:border-primary/30 focus:outline-none"
            />
            {searching && <Loader2 size={14} className="mt-2 animate-spin text-primary" />}
            {results.length > 0 && (
              <div className="mt-2 space-y-0.5 rounded-xl border border-white/8 bg-black/40 p-1.5">
                {results.map((r) => (
                  <button
                    key={`${r.type}-${r.value}`}
                    onClick={() => { onSelect(r); setQuery(""); setResults([]); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    {r.imageUrl ? (
                      <img src={r.imageUrl} alt="" className={`h-8 w-8 flex-shrink-0 bg-white/5 object-cover ${r.type === "artist" ? "rounded-full" : "rounded-md"}`} />
                    ) : (
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Music size={14} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{r.label}</div>
                      <div className="text-[10px] text-white/30">{r.type}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Path card ─────────────────────────────────────────────────────

function PathCard({ path, onPlay, onDelete }: {
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Route size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{path.name}</div>
          <div className="mt-0.5 text-[11px] text-white/40">
            {path.track_count} tracks · {new Date(path.created_at).toLocaleDateString()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary transition hover:bg-primary/25"
        >
          <Play size={14} className="ml-0.5 fill-current" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/15 transition hover:bg-white/5 hover:text-white/40"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export function Paths() {
  const { data: paths, refetch } = useApi<PathSummary[]>("/api/paths");
  const { playAll } = usePlayerActions();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<SearchResult | null>(null);
  const [destination, setDestination] = useState<SearchResult | null>(null);
  const [steps, setSteps] = useState(20);
  const [creating, setCreating] = useState(false);

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
      refetch();
      navigate(`/paths/${result.id}`);
    } catch {
      toast.error("Could not compute path — endpoints may lack audio analysis");
    } finally {
      setCreating(false);
    }
  };

  const playPath = async (pathId: number) => {
    try {
      const detail = await api<PathDetail>(`/api/paths/${pathId}`);
      const tracks: Track[] = detail.tracks.map((t) =>
        toPlayableTrack(t, {
          cover: t.album_id || t.album_entity_uid
            ? albumCoverApiUrl({ albumId: t.album_id, albumEntityUid: t.album_entity_uid, artistEntityUid: t.artist_entity_uid })
            : undefined,
        }),
      );
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <Route size={22} className="text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Music Paths</h1>
          <p className="text-[13px] text-white/40">Trace a route through acoustic space</p>
        </div>
      </div>

      {/* Creator — two panels side by side */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <EndpointPanel side="origin" selected={origin} onSelect={setOrigin} />

        {/* Arrow connector */}
        <div className="flex items-center justify-center sm:py-8">
          <ArrowRight size={20} className="text-primary/40 rotate-90 sm:rotate-0" />
        </div>

        <EndpointPanel side="destination" selected={destination} onSelect={setDestination} />
      </div>

      {/* Steps slider + create button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">Path length</div>
          <div className="flex items-center gap-3">
            <input
              type="range" min={5} max={50} value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-16 text-right font-mono text-[12px] tabular-nums text-white/50">{steps} tracks</span>
          </div>
        </div>
        <button
          onClick={create}
          disabled={!canCreate}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_0_20px_rgba(6,182,212,0.3)] transition hover:bg-primary/90 disabled:opacity-25 disabled:shadow-none"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Route size={15} />}
          Compute Path
        </button>
      </div>

      {/* Saved paths */}
      {paths && paths.length > 0 && (
        <div className="space-y-2 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/30">Your paths</div>
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
    </div>
  );
}
