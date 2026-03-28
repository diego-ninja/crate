import { useParams } from "react-router";

export function Album() {
  const { artist, album } = useParams<{ artist: string; album: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">
        {decodeURIComponent(album || "")}
      </h1>
      <p className="text-white/40 text-sm mb-6">
        {decodeURIComponent(artist || "")}
      </p>
      <p className="text-white/30 text-sm">Coming soon</p>
    </div>
  );
}
