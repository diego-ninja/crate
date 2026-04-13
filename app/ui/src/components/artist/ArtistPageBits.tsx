import { useState } from "react";
import { Link } from "react-router";

import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

export function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-white/40 mb-1">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="text-sm font-semibold text-white/80">{value}</div>
    </div>
  );
}

export function PopularityBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-[40px] h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: "linear-gradient(90deg, #06b6d433, #06b6d4)",
          }}
        />
      </div>
      <span className="text-[10px] text-white/30">{value}</span>
    </div>
  );
}

export function SimilarArtistCard({
  id,
  slug,
  name,
  image,
  genres,
  popularity,
}: {
  id?: number;
  slug?: string;
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const letter = name.charAt(0).toUpperCase();
  const targetPath = id != null ? artistPagePath({ artistId: id, artistSlug: slug, artistName: name }) : null;
  const imageUrl = image || (id != null ? `${artistPhotoApiUrl({ artistId: id, artistSlug: slug, artistName: name })}?v=stable-similar-photo` : "");

  const content = (
    <>
      <div className="w-full aspect-square rounded-xl overflow-hidden mb-2 ring-1 ring-white/5 group-hover:ring-primary/30 transition-all duration-300 group-hover:scale-[1.03]">
        {!imgError && imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            className={`w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : null}
        {(imgError || !imgLoaded || !imageUrl) && (
          <div
            className={`w-full h-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center ${
              imgLoaded && !imgError && imageUrl ? "hidden" : ""
            }`}
          >
            <span className="text-3xl font-bold text-white/20">{letter}</span>
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-white/70 group-hover:text-white truncate transition-colors">
        {name}
      </div>
      {genres && genres.length > 0 && (
        <div className="text-[10px] text-white/30 truncate mt-0.5">{genres.slice(0, 2).join(", ")}</div>
      )}
      {popularity != null && popularity > 0 && (
        <div className="flex justify-center mt-1">
          <PopularityBar value={popularity} />
        </div>
      )}
    </>
  );

  if (targetPath) {
    return <Link to={targetPath} className="group text-center">{content}</Link>;
  }

  return (
    <a
      href={`https://www.last.fm/music/${encodeURIComponent(name)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group text-center"
    >
      {content}
    </a>
  );
}

export function fuzzyMatchTrack<T extends { title: string; album: string; path: string }>(
  songTitle: string,
  tracks: T[],
): T | undefined {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")
      .replace(/\s*\[.*?\]\s*/g, "")
      .replace(/[''`]/g, "'")
      .replace(/[^\w\s']/g, "")
      .trim();

  const normalizedTitle = normalize(songTitle);

  const exact = tracks.find((track) => track.title.toLowerCase() === songTitle.toLowerCase());
  if (exact) return exact;

  const normalized = tracks.find((track) => normalize(track.title) === normalizedTitle);
  if (normalized) return normalized;

  const contains = tracks.find((track) => {
    const normalizedTrack = normalize(track.title);
    return normalizedTrack.includes(normalizedTitle) || normalizedTitle.includes(normalizedTrack);
  });
  if (contains) return contains;

  return tracks.find(
    (track) =>
      normalize(track.title).startsWith(normalizedTitle) || normalizedTitle.startsWith(normalize(track.title)),
  );
}
