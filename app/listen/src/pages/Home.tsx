import { useState, useEffect } from "react";

interface Section {
  title: string;
  items: { id: string; title: string; subtitle: string; cover?: string }[];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function SectionRow({ title, items }: Section) {
  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {items.map((item) => (
          <div key={item.id} className="shrink-0 w-36">
            {item.cover ? (
              <img
                src={item.cover}
                alt=""
                className="w-36 h-36 rounded-lg object-cover bg-white/5"
              />
            ) : (
              <div className="w-36 h-36 rounded-lg bg-white/5" />
            )}
            <p className="text-sm text-white mt-2 truncate">{item.title}</p>
            <p className="text-xs text-white/40 truncate">{item.subtitle}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const [recentlyPlayed, setRecentlyPlayed] = useState<Section["items"]>([]);
  const [playlists, setPlaylists] = useState<Section["items"]>([]);
  const [newArtists, setNewArtists] = useState<Section["items"]>([]);

  useEffect(() => {
    fetch("/api/navidrome/recently-played")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setRecentlyPlayed(
            data.slice(0, 10).map((d: Record<string, string>) => ({
              id: d.id || d.title || "unknown",
              title: d.title || "Unknown",
              subtitle: d.artist || "",
              cover: d.cover || d.albumCover,
            })),
          );
        }
      })
      .catch(() => {});

    fetch("/api/playlists")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setPlaylists(
            data.slice(0, 10).map((d: Record<string, string | number>) => ({
              id: String(d.id),
              title: String(d.name || d.title || "Playlist"),
              subtitle: `${d.track_count || 0} tracks`,
              cover: d.cover as string | undefined,
            })),
          );
        }
      })
      .catch(() => {});

    fetch("/api/browse/artists?sort=recent&limit=8")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setNewArtists(
            data.map((d: Record<string, string | number>) => ({
              id: String(d.name || d.id),
              title: String(d.name || "Unknown"),
              subtitle: `${d.album_count || 0} albums`,
              cover: d.image as string | undefined,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">{getGreeting()}</h1>

      <SectionRow title="Recently Played" items={recentlyPlayed} />
      <SectionRow title="Your Playlists" items={playlists} />
      <SectionRow title="New in Library" items={newArtists} />

      {recentlyPlayed.length === 0 && playlists.length === 0 && newArtists.length === 0 && (
        <p className="text-white/30 text-sm mt-8">Your library is loading...</p>
      )}
    </div>
  );
}
