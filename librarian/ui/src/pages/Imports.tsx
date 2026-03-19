import { useState } from "react";
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
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PendingItem {
  source: string;
  source_path: string;
  artist: string;
  album: string;
  track_count: number;
  formats: string[];
  total_size_mb: number;
  dest_exists: boolean;
}

export function Imports() {
  const [pending, setPending] = useState<PendingItem[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Set<number>>(new Set());

  async function scan() {
    const data = await api<PendingItem[]>("/api/imports/pending");
    setPending(data);
  }

  async function importOne(idx: number) {
    const item = pending![idx]!;
    const res = await api<{ status?: string; error?: string }>(
      "/api/imports/import",
      "POST",
      {
        source_path: item.source_path,
        artist: item.artist,
        album: item.album,
      },
    );
    if (res.status === "imported" || res.status === "merged") {
      setImported((prev) => new Set(prev).add(idx));
      toast.success(`Imported "${item.album}" by ${item.artist}`);
    }
  }

  async function importAll() {
    setImporting(true);
    try {
      await api("/api/imports/import-all", "POST", {});
      toast.success("All imports completed");
      scan();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Import Queue</h2>
        <div className="flex gap-2">
          <Button onClick={scan}>Scan Downloads</Button>
          <Button
            variant="outline"
            className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
            onClick={importAll}
            disabled={!pending || importing}
          >
            {importing ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                Importing...
              </>
            ) : (
              "Import All"
            )}
          </Button>
        </div>
      </div>

      {pending !== null && pending.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No pending imports found in download directories
        </div>
      )}

      {pending && pending.length > 0 && (
        <>
          <p className="text-muted-foreground mb-4 text-sm">
            {pending.length} albums ready to import
          </p>
          {Object.entries(
            pending.reduce<Record<string, { items: PendingItem[]; indices: number[] }>>(
              (acc, item, idx) => {
                const group = acc[item.source] || { items: [], indices: [] };
                group.items.push(item);
                group.indices.push(idx);
                acc[item.source] = group;
                return acc;
              },
              {},
            ),
          ).map(([source, { items, indices }]) => (
            <div key={source} className="mb-8">
              <h3 className="font-semibold mb-3 capitalize">
                {source} ({items.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>Tracks</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, i) => {
                    const globalIdx = indices[i]!;
                    return (
                      <TableRow
                        key={item.source_path}
                        className={imported.has(globalIdx) ? "opacity-40" : ""}
                      >
                        <TableCell>{item.artist}</TableCell>
                        <TableCell>{item.album}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.track_count}
                        </TableCell>
                        <TableCell>
                          {item.formats.map((f) => (
                            <Badge key={f} variant="outline" className="mr-1 text-[10px]">
                              {f.replace(".", "").toUpperCase()}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.total_size_mb} MB
                        </TableCell>
                        <TableCell>
                          {item.dest_exists ? (
                            <span className="text-yellow-500">Exists</span>
                          ) : (
                            <span className="text-green-500">New</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
                            onClick={() => importOne(globalIdx)}
                          >
                            Import
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
