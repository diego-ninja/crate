import { useState, useEffect, useRef } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { Progress } from "@crate/ui/shadcn/progress";
import { Badge } from "@crate/ui/shadcn/badge";
import { cn } from "@/lib/utils";

export interface ScanProgressData {
  scanner: string;
  artist: string;
  artists_done: number;
  artists_total: number;
  issues_found: number;
  issues_by_type: Record<string, number>;
  scanners_done: string[];
  scanners_total: number;
  current_scanner_index: number;
}

const SCANNER_NAMES: Record<string, string> = {
  nested: "Nested",
  naming: "Naming",
  duplicates: "Duplicates",
  mergeable: "Mergeable",
  incomplete: "Incomplete",
};

const ALL_SCANNERS = ["nested", "naming", "duplicates", "mergeable", "incomplete"];

const ISSUE_COLORS: Record<string, string> = {
  nested_library: "text-red-400 border-red-400/40",
  duplicate_album: "text-orange-400 border-orange-400/40",
  bad_naming: "text-yellow-400 border-yellow-400/40",
  mergeable_album: "text-orange-400 border-orange-400/40",
  incomplete_album: "text-blue-400 border-blue-400/40",
};

const ISSUE_LABELS: Record<string, string> = {
  nested_library: "Nested",
  duplicate_album: "Duplicates",
  bad_naming: "Naming",
  mergeable_album: "Mergeable",
  incomplete_album: "Incomplete",
};

interface ScanProgressProps {
  progress: ScanProgressData;
}

export function ScanProgress({ progress }: ScanProgressProps) {
  const percent = progress.artists_total > 0
    ? Math.round((progress.artists_done / progress.artists_total) * 100)
    : 0;

  const startRef = useRef<number>(Date.now());
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = (now - startRef.current) / 1000;
  const rate = elapsedSec > 0 ? progress.artists_done / elapsedSec : 0;
  const remaining = rate > 0 ? (progress.artists_total - progress.artists_done) / rate : 0;
  const remainingMin = Math.ceil(remaining / 60);

  const doneScanners = new Set(progress.scanners_done);
  const currentScanner = progress.scanner;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <Progress value={percent} className="h-2.5" />
        <p className="text-sm text-muted-foreground mt-1.5">
          Scanning artist {progress.artists_done}/{progress.artists_total} ({percent}%)
        </p>
      </div>

      {/* Scanner pipeline */}
      <div className="flex gap-2 flex-wrap">
        {ALL_SCANNERS.map((id) => {
          const isDone = doneScanners.has(id);
          const isRunning = currentScanner === id;
          return (
            <div
              key={id}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                isDone && "border-l-2 border-l-green-500 border-green-500/30 text-green-400 bg-green-500/5",
                isRunning && "border-l-2 border-l-blue-500 border-blue-500/30 text-blue-400 bg-blue-500/5",
                !isDone && !isRunning && "border-border text-muted-foreground",
              )}
            >
              {isDone && <Check size={14} />}
              {isRunning && <Loader2 size={14} className="animate-spin" />}
              {!isDone && !isRunning && <Circle size={14} />}
              <span>{SCANNER_NAMES[id] ?? id}</span>
              {isRunning && progress.artist && (
                <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[100px]">
                  {progress.artist}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Issue counters */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(progress.issues_by_type).map(([type, count]) => (
          <Badge
            key={type}
            variant="outline"
            className={cn(
              "text-xs",
              count > 0 ? ISSUE_COLORS[type] ?? "text-orange-400 border-orange-400/40" : "text-muted-foreground border-border",
            )}
          >
            {ISSUE_LABELS[type] ?? type.replace(/_/g, " ")}: {count}
          </Badge>
        ))}
      </div>

      {/* Time estimate */}
      <p className="text-xs text-muted-foreground">
        {percent >= 90
          ? "Almost done..."
          : remainingMin > 0
            ? `~${remainingMin} min remaining`
            : "Estimating time..."}
      </p>
    </div>
  );
}
