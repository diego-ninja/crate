import { useNavigate } from "react-router";
import { Heart, Clock, Sparkles, ListMusic, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";

interface RecentAlbum {
  id: string;
  title: string;
  artist: string;
  album_id?: string;
  album?: string;
}

interface NewArtist {
  name: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
  updated_at?: string;
}

interface Playlist {
  id: number;
  name: string;
  description?: string;
  track_count: number;
  is_smart: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDateString(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function playlistGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 50%, 30%), hsl(${hue2}, 60%, 20%))`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold px-1">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {children}
      </div>
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={20} className="text-primary animate-spin" />
    </div>
  );
}

const quickLinks = [
  { label: "Liked Songs", icon: Heart, to: "/library" },
  { label: "Recently Played", icon: Clock, to: "/library" },
  { label: "New Releases", icon: Sparkles, to: "/explore" },
  { label: "Your Playlists", icon: ListMusic, to: "/library" },
];

export function Home() {
  const navigate = useNavigate();

  const { data: recentAlbums, loading: recentLoading } =
    useApi<RecentAlbum[]>("/api/navidrome/recently-played");
  const { data: newArtists, loading: artistsLoading } =
    useApi<NewArtist[]>("/api/artists?sort=recent&limit=10");
  const { data: playlists, loading: playlistsLoading } =
    useApi<Playlist[]>("/api/playlists");

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">{getGreeting()}</h1>
        <p className="text-sm text-muted-foreground mt-1">{getDateString()}</p>
      </div>

      {/* Quick Access */}
      <div className="grid grid-cols-2 gap-3">
        {quickLinks.map(({ label, icon: Icon, to }) => (
          <button
            key={label}
            onClick={() => navigate(to)}
            className="flex items-center gap-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors p-3 text-left"
          >
            <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center flex-shrink-0">
              <Icon size={16} className="text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Recently Played */}
      {recentLoading ? (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Recently Played</h2>
          <SectionLoading />
        </div>
      ) : recentAlbums && recentAlbums.length > 0 ? (
        <Section title="Recently Played">
          {recentAlbums.slice(0, 10).map((item) => (
            <AlbumCard
              key={item.id || item.title}
              artist={item.artist}
              album={item.title || item.album || "Unknown"}
            />
          ))}
        </Section>
      ) : null}

      {/* New in Library */}
      {artistsLoading ? (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">New in Library</h2>
          <SectionLoading />
        </div>
      ) : newArtists && newArtists.length > 0 ? (
        <Section title="New in Library">
          {newArtists.map((artist) => (
            <ArtistCard
              key={artist.name}
              name={artist.name}
              subtitle={`${artist.album_count} album${artist.album_count !== 1 ? "s" : ""}`}
            />
          ))}
        </Section>
      ) : null}

      {/* Your Playlists */}
      {playlistsLoading ? (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Your Playlists</h2>
          <SectionLoading />
        </div>
      ) : playlists && playlists.length > 0 ? (
        <Section title="Your Playlists">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => navigate(`/playlist/${pl.id}`)}
              className="flex-shrink-0 w-[160px] rounded-xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <div
                className="aspect-square flex flex-col justify-end p-3"
                style={{ background: playlistGradient(pl.name) }}
              >
                <ListMusic size={24} className="text-white/40 mb-2" />
                <div className="text-sm font-bold text-white truncate">{pl.name}</div>
                <div className="text-xs text-white/50">
                  {pl.track_count} track{pl.track_count !== 1 ? "s" : ""}
                </div>
              </div>
            </button>
          ))}
        </Section>
      ) : null}
    </div>
  );
}
