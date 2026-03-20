import { Badge } from "@/components/ui/badge";
import { Search, Music } from "lucide-react";

interface MissingAlbumCardProps {
  title: string;
  year: string;
  type: string;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 30%, 15%)`;
}

const typeBadgeClass: Record<string, string> = {
  Album: "border-blue-500/30 text-blue-500",
  EP: "border-cyan-500/30 text-cyan-500",
  Single: "border-yellow-500/30 text-yellow-500",
  Compilation: "border-orange-500/30 text-orange-500",
};

export function MissingAlbumCard({ title, year, type }: MissingAlbumCardProps) {
  return (
    <div className="border border-dashed border-border rounded-lg p-3 text-center grayscale opacity-60 hover:opacity-80 transition-opacity">
      <div
        className="w-full aspect-square rounded-md overflow-hidden mb-2 relative flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${hashColor(title)}, ${hashColor(title + title)})` }}
      >
        <span className="text-3xl font-bold text-white/20">{title.charAt(0).toUpperCase()}</span>
        <Music size={16} className="text-white/10 absolute bottom-2 right-2" />
      </div>
      <div className="font-semibold text-sm text-left truncate">{title}</div>
      <div className="text-xs text-muted-foreground text-left flex items-center gap-1 flex-wrap mt-0.5">
        <span>{year || "?"}</span>
        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${typeBadgeClass[type] || ""}`}>
          {type}
        </Badge>
      </div>
      <a
        href="https://search.lespedants.org"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Search size={12} /> Search
      </a>
    </div>
  );
}
