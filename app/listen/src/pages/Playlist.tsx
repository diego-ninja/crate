import { useParams } from "react-router";

export function Playlist() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Playlist {id}</h1>
      <p className="text-white/30 text-sm">Coming soon</p>
    </div>
  );
}
