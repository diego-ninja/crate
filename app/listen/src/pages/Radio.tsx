import { useState, useCallback, useEffect } from "react";
import { Loader2, Music, Radio as RadioIcon, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import {
  startShapedRadio,
  checkDiscoveryAvailable,
} from "@/lib/radio";

type EndpointType = "artist" | "genre" | "album" | "track";

interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
}

export function RadioPage() {
  const { playAll } = usePlayerActions();
  const [discoveryAvailable, setDiscoveryAvailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [seedLabel, setSeedLabel] = useState("");

  // Seed picker state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    checkDiscoveryAvailable().then(setDiscoveryAvailable);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const [searchData, genresData] = await Promise.all([
        api<{
          artists?: { id: number; name: string; slug?: string }[];
          albums?: { id: number; name: string; artist: string }[];
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
          type: "artist", value: String(a.id), label: a.name,
          imageUrl: artistPhotoApiUrl({ artistId: a.id, artistSlug: a.slug, artistName: a.name }),
        });
      }
      for (const a of searchData.albums?.slice(0, 3) ?? []) {
        items.push({
          type: "album", value: String(a.id ?? 0), label: `${a.name} — ${a.artist}`,
          imageUrl: albumCoverApiUrl({ albumId: a.id, albumName: a.name, artistName: a.artist }),
        });
      }
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const startSeeded = async (seed: SearchResult) => {
    setStarting(true);
    setQuery("");
    setResults([]);
    const result = await startShapedRadio("seeded", seed.type, seed.value);
    if (!result) {
      toast.error("Could not start radio");
      setStarting(false);
      return;
    }
    setActiveSession(result.sessionId);
    setSeedLabel(result.seedLabel);
    playAll(result.tracks, 0, result.source);
    setStarting(false);
  };

  const startDiscovery = async () => {
    setStarting(true);
    const result = await startShapedRadio("discovery");
    if (!result) {
      toast.error("Not enough data for Discovery Radio yet");
      setStarting(false);
      return;
    }
    setActiveSession(result.sessionId);
    setSeedLabel(result.seedLabel);
    playAll(result.tracks, 0, result.source);
    setStarting(false);
  };

  return (
    <div className="animate-page-in space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <RadioIcon size={22} className="text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Radio</h1>
          <p className="text-[13px] text-white/40">Infinite music, shaped by your taste</p>
        </div>
      </div>

      {/* Discovery Radio — prominent card */}
      {discoveryAvailable && (
        <button
          onClick={startDiscovery}
          disabled={starting}
          className="group flex w-full items-center gap-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 text-left transition hover:border-primary/35 hover:from-primary/15 disabled:opacity-50"
        >
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-[0_0_20px_rgba(6,182,212,0.2)] transition group-hover:shadow-[0_0_30px_rgba(6,182,212,0.3)]">
            {starting ? <Loader2 size={24} className="animate-spin" /> : <Sparkles size={24} />}
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">Discovery Radio</div>
            <div className="mt-0.5 text-[13px] text-white/45">
              Based on your likes, follows, and listening history. Like or dislike tracks to shape the sound.
            </div>
          </div>
        </button>
      )}

      {/* Seeded Radio — search to start */}
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <RadioIcon size={16} className="text-primary" />
          Start a radio station
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
          placeholder="Search an artist, genre, or album to seed the radio..."
          className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-foreground placeholder:text-white/25 focus:border-primary/30 focus:outline-none"
        />

        {searching && <Loader2 size={14} className="mt-2 animate-spin text-primary" />}

        {results.length > 0 && (
          <div className="mt-2 space-y-0.5 rounded-xl border border-white/8 bg-black/40 p-1.5">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.value}`}
                onClick={() => void startSeeded(r)}
                disabled={starting}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt="" className={`h-9 w-9 flex-shrink-0 bg-white/5 object-cover ${r.type === "artist" ? "rounded-full" : "rounded-md"}`} />
                ) : (
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Music size={16} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="text-[10px] text-white/30">{r.type} radio</div>
                </div>
                <RadioIcon size={14} className="flex-shrink-0 text-primary/40" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active session info */}
      {activeSession && (
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
            <span className="text-sm font-medium text-primary">{seedLabel} Radio</span>
            <span className="text-[11px] text-white/30">playing</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/40">
            <ThumbsUp size={10} /> Like and <ThumbsDown size={10} /> dislike tracks in the player to shape the radio
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-white/6 bg-white/[0.01] p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-white/30">How it works</div>
        <div className="space-y-3 text-[13px] leading-relaxed text-white/45">
          <p>
            Radio uses bliss similarity vectors, artist connections, and genre
            overlap to find tracks that naturally flow from your seed. No fixed
            playlist — the queue generates endlessly.
          </p>
          <p>
            When you <strong className="text-white/60">like</strong> a track, the radio shifts toward that
            sound. When you <strong className="text-white/60">dislike</strong>, it steers away. The more
            feedback you give, the more the radio learns what you want to hear
            in this session.
          </p>
        </div>
      </div>
    </div>
  );
}
