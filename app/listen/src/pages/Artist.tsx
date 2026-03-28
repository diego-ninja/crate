import { useParams } from "react-router";

export function Artist() {
  const { name } = useParams<{ name: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">{decodeURIComponent(name || "")}</h1>
      <p className="text-white/30 text-sm">Coming soon</p>
    </div>
  );
}
