import { useState } from "react";
import { useParams } from "react-router";
import { Play, Shuffle, Radio, ChevronDown, ChevronUp, Users } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { encPath, formatCompact } from "@/lib/utils";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";

interface ArtistAlbum {
  name: string;
  display_name: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
}

interface ArtistData {
  name: string;
  albums: ArtistAlbum[];
  total_tracks: number;
  total_size_mb: number;
  primary_format: string | null;
  genres: string[];
  issue_count: number;
}

interface ArtistInfo {
  bio: string;
  tags: string[];
  similar: { name: string; match: number }[];
  listeners: number;
  playcount: number;
  image_url: string | null;
  url: string;
}

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name || "");
  const [bioExpanded, setBioExpanded] = useState(false);

  const { data, loading, error } = useApi<ArtistData>(
    decodedName ? `/api/artist/${encPath(decodedName)}` : null,
  );
  const { data: info } = useApi<ArtistInfo>(
    decodedName ? `/api/artist/${encPath(decodedName)}/info` : null,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Artist not found</p>
      </div>
    );
  }

  const photoUrl = `/api/artist/${encPath(data.name)}/photo`;
  const tags = data.genres.length > 0 ? data.genres : (info?.tags ?? []);
  const similarArtists = info?.similar ?? [];
  const bio = info?.bio ?? "";

  const albumsSorted = [...data.albums].sort((a, b) => {
    const ya = parseInt(a.year) || 0;
    const yb = parseInt(b.year) || 0;
    return yb - ya;
  });

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      {/* Hero */}
      <div className="relative h-[320px] sm:h-[380px] overflow-hidden">
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />

        <div className="relative h-full flex items-end px-4 sm:px-6 pb-6">
          <div className="flex items-end gap-5">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden bg-white/5 flex-shrink-0 shadow-2xl ring-2 ring-white/10">
              <img
                src={photoUrl}
                alt={data.name}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div className="pb-1">
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">{data.name}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {info?.listeners ? (
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {formatCompact(info.listeners)} listeners
                  </span>
                ) : null}
                {data.total_tracks > 0 && (
                  <span>{data.total_tracks} tracks</span>
                )}
                {data.albums.length > 0 && (
                  <span>{data.albums.length} albums</span>
                )}
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tags.slice(0, 8).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-xs rounded-full bg-white/8 text-muted-foreground border border-white/10"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4">
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          onClick={() => {/* TODO: Play All */}}
        >
          <Play size={16} fill="currentColor" />
          Play All
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={() => {/* TODO: Shuffle */}}
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={() => {/* TODO: Radio */}}
        >
          <Radio size={15} />
          Radio
        </button>
      </div>

      <div className="px-4 sm:px-6 pb-8 space-y-8">
        {/* Albums */}
        {albumsSorted.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albumsSorted.map((album) => (
                <AlbumCard
                  key={album.name}
                  artist={data.name}
                  album={album.display_name || album.name}
                  year={album.year?.slice(0, 4)}
                  cover={`/api/cover/${encPath(data.name)}/${encPath(album.name)}`}
                />
              ))}
            </div>
          </section>
        )}

        {/* Similar Artists */}
        {similarArtists.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Similar Artists</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 scrollbar-hide">
              {similarArtists.slice(0, 15).map((s) => (
                <ArtistCard key={s.name} name={s.name} compact />
              ))}
            </div>
          </section>
        )}

        {/* Bio */}
        {bio && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">About</h2>
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed whitespace-pre-line ${
                  !bioExpanded ? "line-clamp-3" : ""
                }`}
              >
                {bio}
              </p>
              {bio.length > 200 && (
                <button
                  className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                  onClick={() => setBioExpanded((v) => !v)}
                >
                  {bioExpanded ? (
                    <>Show less <ChevronUp size={12} /></>
                  ) : (
                    <>Read more <ChevronDown size={12} /></>
                  )}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
