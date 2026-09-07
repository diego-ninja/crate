import { ListMusic } from "@crate/ui/icons";
import type { CSSProperties, ImgHTMLAttributes, Key, ReactNode } from "react";

export interface PlaylistArtworkTrack {
  artist?: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  global_album_uid?: string;
  album_entity_uid?: string;
  album_slug?: string;
}

export interface PlaylistArtworkImageProps
  extends ImgHTMLAttributes<HTMLImageElement> {
  key?: Key;
}

interface PlaylistArtworkProps {
  name?: string;
  coverDataUrl?: string | null;
  tracks?: PlaylistArtworkTrack[];
  className?: string;
  showCrateMark?: boolean;
  crateMarkClassName?: string;
  logoSrc?: string;
  buildCoverUrl: (track: PlaylistArtworkTrack) => string | null;
  renderImage?: (props: PlaylistArtworkImageProps) => ReactNode;
}

function playlistGradientHues(name: string): { hue1: number; hue2: number } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 44) % 360;
  return { hue1, hue2 };
}

function CrateMark({
  logoSrc,
  className = "",
}: {
  logoSrc: string;
  className?: string;
}) {
  return (
    <div
      className={`absolute right-2.5 top-2.5 flex items-center justify-center ${className}`}
    >
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className=" size-4 opacity-95 drop-shadow-artwork-compact-mark"
      />
    </div>
  );
}

export function PlaylistArtwork({
  name = "Playlist",
  coverDataUrl,
  tracks = [],
  className = "",
  showCrateMark = false,
  crateMarkClassName,
  logoSrc = "/icons/logo.svg",
  buildCoverUrl,
  renderImage,
}: PlaylistArtworkProps) {
  const collageSources: string[] = [];
  const collageSourceSet = new Set<string>();
  for (const track of tracks) {
    const source = buildCoverUrl(track);
    if (source && !collageSourceSet.has(source)) {
      collageSources.push(source);
      collageSourceSet.add(source);
    }
    if (collageSources.length >= 4) break;
  }

  const crateMark = showCrateMark ? (
    <CrateMark logoSrc={logoSrc} className={crateMarkClassName} />
  ) : null;
  const artworkImage = (props: PlaylistArtworkImageProps) => {
    if (renderImage) return renderImage(props);
    const { key, ...imageProps } = props;
    return <img key={key} {...imageProps} />;
  };

  if (coverDataUrl) {
    return (
      <div
        className={`relative overflow-hidden bg-text-primary/5 ${className}`}
      >
        {artworkImage({
          src: coverDataUrl,
          alt: name,
          className: "size-full object-cover",
        })}
        {crateMark}
      </div>
    );
  }

  if (collageSources.length > 0) {
    if (collageSources.length === 1) {
      return (
        <div
          className={`relative overflow-hidden bg-text-primary/5 ${className}`}
        >
          {artworkImage({
            src: collageSources[0],
            alt: name,
            className: "size-full object-cover",
          })}
          {crateMark}
        </div>
      );
    }

    const collageClassName =
      collageSources.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

    return (
      <div
        className={`relative overflow-hidden bg-text-primary/5 ${className}`}
      >
        <div className={`grid size-full ${collageClassName} gap-[2px]`}>
          {collageSources.map((source, index) =>
            artworkImage({
              key: `${source}-${index}`,
              src: source,
              alt: "",
              className: `size-full object-cover ${
                collageSources.length === 3 && index === 2 ? "col-span-2" : ""
              }`,
            }),
          )}
        </div>
        {crateMark}
      </div>
    );
  }

  const { hue1, hue2 } = playlistGradientHues(name);

  return (
    <div
      className={`playlist-artwork-placeholder relative flex items-center justify-center overflow-hidden ${className}`}
      style={
        {
          "--playlist-artwork-hue-1": String(hue1),
          "--playlist-artwork-hue-2": String(hue2),
        } as CSSProperties
      }
    >
      <ListMusic size={24} className="text-text-primary/60" />
      {crateMark}
    </div>
  );
}
