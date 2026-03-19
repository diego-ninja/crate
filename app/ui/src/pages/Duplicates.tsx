import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Issue {
  type: string;
  description: string;
  suggestion: string;
  paths: string[];
  details: { keep?: string; remove?: string[] };
}

interface DupAlbum {
  path: string;
  name: string;
  artist: string;
  track_count: number;
  total_size_mb: number;
  formats: string[];
  has_cover: boolean;
  tracks: {
    tracknumber: string;
    title: string;
    bitrate: number | null;
  }[];
}

export function Duplicates() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [comparisons, setComparisons] = useState<Record<number, { albums: DupAlbum[]; selected: number }>>({});
  const [resolved, setResolved] = useState<Set<number>>(new Set());
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scanDuplicates = useCallback(async () => {
    setScanning(true);
    await api("/api/scan", "POST", { only: "duplicates" });

    const poll = async () => {
      const s = await api<{ scanning: boolean }>("/api/status");
      if (s.scanning) {
        pollRef.current = setTimeout(poll, 2000);
        return;
      }
      const data = await api<Issue[]>("/api/issues?type=duplicate_album");
      setIssues(data);
      setScanning(false);
    };
    pollRef.current = setTimeout(poll, 2000);
  }, []);

  async function compare(idx: number) {
    const issue = issues![idx]!;
    const paths = issue.paths.map((p) => p.replace("/music/", ""));
    const qs = paths.map((p) => `path=${encodeURIComponent(p)}`).join("&");
    const albums = await api<DupAlbum[]>(`/api/duplicates/compare?${qs}`);
    setComparisons((prev) => ({ ...prev, [idx]: { albums, selected: 0 } }));
  }

  async function resolve(idx: number) {
    const comp = comparisons[idx];
    if (!comp) return;
    const keep = comp.albums[comp.selected]!.path;
    const remove = comp.albums
      .filter((_, i) => i !== comp.selected)
      .map((a) => a.path);
    await api("/api/duplicates/resolve", "POST", { keep, remove });
    setResolved((prev) => new Set(prev).add(idx));
    setConfirmIdx(null);
  }

  const confirmComp = confirmIdx !== null ? comparisons[confirmIdx] : null;

  return (
    <div>
      <h2 className="font-semibold mb-2">Duplicate Resolver</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Run a duplicates scan first from Health, then resolve them here.
      </p>
      <Button onClick={scanDuplicates} disabled={scanning}>
        {scanning ? "Scanning..." : "Scan for Duplicates"}
      </Button>

      <div className="mt-6">
        {issues !== null && issues.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No duplicates found
          </div>
        )}
        {issues?.map((issue, idx) => (
          <div
            key={idx}
            className="bg-card border border-border rounded-lg p-4 mb-3"
          >
            {resolved.has(idx) ? (
              <div className="text-green-500 py-2">Resolved</div>
            ) : (
              <>
                <div className="text-sm mb-1">{issue.description}</div>
                <div className="text-sm text-green-500 mb-3">
                  {issue.suggestion}
                </div>
                <div className="flex gap-2 mb-3">
                  <Button size="sm" variant="outline" onClick={() => compare(idx)}>
                    Compare
                  </Button>
                </div>
                {comparisons[idx] != null && (
                  <>
                    <div className="flex gap-4 mt-4">
                      {comparisons[idx]!.albums.map((a, i) => (
                        <div
                          key={a.path}
                          onClick={() =>
                            setComparisons((prev) => ({
                              ...prev,
                              [idx]: { ...prev[idx]!, selected: i },
                            }))
                          }
                          className={cn(
                            "flex-1 bg-card border rounded-lg p-4 cursor-pointer",
                            comparisons[idx]!.selected === i
                              ? "border-green-500 shadow-[0_0_0_1px] shadow-green-500"
                              : "border-border",
                          )}
                        >
                          <div className="flex justify-between mb-2">
                            <strong className="text-sm">{a.name}</strong>
                            <div className="flex gap-1">
                              {a.formats.map((f) => (
                                <Badge key={f} variant="outline" className="text-[10px]">
                                  {f.replace(".", "").toUpperCase()}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">
                            {a.track_count} tracks &middot; {a.total_size_mb} MB
                            {a.has_cover ? " \u00B7 Has cover" : ""}
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Title</TableHead>
                                <TableHead>Bitrate</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {a.tracks.map((t) => (
                                <TableRow key={t.title}>
                                  <TableCell className="text-muted-foreground">
                                    {t.tracknumber || "?"}
                                  </TableCell>
                                  <TableCell className="text-sm">{t.title}</TableCell>
                                  <TableCell className="text-muted-foreground font-mono text-sm">
                                    {t.bitrate ? `${t.bitrate}k` : "-"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmIdx(idx)}
                      >
                        Keep selected, trash others
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmIdx !== null}
        onOpenChange={(open) => !open && setConfirmIdx(null)}
        title="Resolve Duplicate"
        description={
          confirmComp
            ? `Keep "${confirmComp.albums[confirmComp.selected]!.name}" and trash ${confirmComp.albums.length - 1} other(s)?`
            : ""
        }
        confirmLabel="Trash others"
        variant="destructive"
        onConfirm={() => confirmIdx !== null && resolve(confirmIdx)}
      />
    </div>
  );
}
