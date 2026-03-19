import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface MissingAlbum {
  artist: string;
  album: string;
  track_count: number;
  mbid: string | null;
  path: string;
}

export function Artwork() {
  const [missing, setMissing] = useState<MissingAlbum[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  async function scan() {
    setScanning(true);
    try {
      const data = await api<MissingAlbum[]>("/api/artwork/missing");
      setMissing(data);
    } finally {
      setScanning(false);
    }
  }

  async function fetchCover(idx: number) {
    const a = missing![idx]!;
    const res = await api<{ status?: string; error?: string }>(
      "/api/artwork/fetch",
      "POST",
      { mbid: a.mbid, path: a.path.replace("/music/", "") },
    );
    if (res.status === "saved") {
      setDone((prev) => new Set(prev).add(idx));
    }
  }

  async function extractCover(idx: number) {
    const a = missing![idx]!;
    const res = await api<{ status?: string; error?: string }>(
      "/api/artwork/extract",
      "POST",
      { path: a.path.replace("/music/", "") },
    );
    if (res.status === "saved") {
      setDone((prev) => new Set(prev).add(idx));
    }
  }

  async function fetchAll() {
    setFetchingAll(true);
    try {
      await api("/api/artwork/fetch-all", "POST", {});
      scan();
    } finally {
      setFetchingAll(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Album Art Manager</h2>
        <div className="flex gap-2">
          <Button onClick={scan} disabled={scanning}>
            {scanning ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                Scanning...
              </>
            ) : (
              "Scan Missing Covers"
            )}
          </Button>
          <Button
            variant="outline"
            className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
            onClick={fetchAll}
            disabled={!missing || fetchingAll}
          >
            {fetchingAll ? "Fetching..." : "Fetch All from CAA"}
          </Button>
        </div>
      </div>

      {missing !== null && missing.length === 0 && (
        <div className="text-center py-12 text-green-500">
          All albums have cover art!
        </div>
      )}

      {missing && missing.length > 0 && (
        <>
          <p className="text-muted-foreground mb-4 text-sm">
            {missing.length} albums without cover art
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artist</TableHead>
                <TableHead>Album</TableHead>
                <TableHead>Tracks</TableHead>
                <TableHead>MBID</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missing.map((a, i) => (
                <TableRow
                  key={`${a.artist}-${a.album}`}
                  className={done.has(i) ? "opacity-40" : ""}
                >
                  <TableCell>{a.artist}</TableCell>
                  <TableCell>
                    <button
                      onClick={() =>
                        navigate(
                          `/album/${encPath(a.artist)}/${encPath(a.album)}`,
                        )
                      }
                      className="text-primary hover:underline"
                    >
                      {a.album}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.track_count}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {a.mbid ? (
                      `${a.mbid.slice(0, 8)}...`
                    ) : (
                      <span className="text-red-500">none</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {a.mbid && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
                          onClick={() => fetchCover(i)}
                        >
                          Fetch CAA
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => extractCover(i)}
                      >
                        Extract embedded
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
