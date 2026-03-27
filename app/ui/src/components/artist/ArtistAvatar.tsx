import { useState } from "react";
import { Link } from "react-router";
import { encPath } from "@/lib/utils";

interface ArtistAvatarProps {
  name: string;
  size?: number;
  linked?: boolean;
}

export function ArtistAvatar({ name, size = 36, linked = false }: ArtistAvatarProps) {
  const [failed, setFailed] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  const img = !failed ? (
    <img
      src={`/api/artist/${encPath(name)}/photo`}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="text-[10px] font-bold text-foreground/60">{letter}</span>
  );

  const wrapper = (
    <div
      className="rounded-full ring-2 ring-card overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
      title={name}
    >
      {img}
    </div>
  );

  if (linked) {
    return (
      <Link to={`/artist/${encPath(name)}`} className="hover:ring-primary/50 rounded-full transition-all">
        {wrapper}
      </Link>
    );
  }
  return wrapper;
}

export function ArtistAvatarStack({ names, size = 18 }: { names: string[]; size?: number }) {
  return (
    <div className="flex -space-x-1 flex-shrink-0">
      {names.map((n) => (
        <ArtistAvatar key={n} name={n} size={size} />
      ))}
    </div>
  );
}
