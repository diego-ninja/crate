import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

interface QualityData {
  corrupt_count: number;
  low_bitrate_count: number;
  lossy_with_lossless_count: number;
  mixed_format_count: number;
  corrupt: { artist: string; album: string; file: string; reason: string }[];
  low_bitrate: {
    artist: string;
    album: string;
    file: string;
    bitrate_kbps: number;
  }[];
  lossy_with_lossless: {
    artist: string;
    lossy_album: string;
    lossy_formats: string[];
    lossless_album: string;
  }[];
  mixed_format_albums: {
    artist: string;
    album: string;
    formats: string[];
    track_count: number;
  }[];
}

export function Quality() {
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const result = await api<QualityData>("/api/quality");
      setData(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Quality Report</h2>
        <Button onClick={run} disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1" />
              Scanning...
            </>
          ) : (
            "Generate Report"
          )}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        Detect low bitrate files, lossy duplicates of lossless albums, corrupt
        files, and mixed-format albums.
      </p>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-card">
              <CardContent className="pt-6 text-center">
                <div
                  className={`text-2xl font-bold ${data.corrupt_count ? "text-red-500" : "text-green-500"}`}
                >
                  {data.corrupt_count}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Corrupt
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="pt-6 text-center">
                <div
                  className={`text-2xl font-bold ${data.low_bitrate_count ? "text-yellow-500" : "text-green-500"}`}
                >
                  {data.low_bitrate_count}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Low Bitrate
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="pt-6 text-center">
                <div
                  className={`text-2xl font-bold ${data.lossy_with_lossless_count ? "text-orange-500" : "text-green-500"}`}
                >
                  {data.lossy_with_lossless_count}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Lossy w/ Lossless
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardContent className="pt-6 text-center">
                <div className="text-2xl font-bold">
                  {data.mixed_format_count}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Mixed Format
                </div>
              </CardContent>
            </Card>
          </div>

          {data.corrupt.length > 0 && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3 text-red-500">
                Corrupt / Unreadable Files ({data.corrupt.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.corrupt.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>{c.artist}</TableCell>
                      <TableCell>{c.album}</TableCell>
                      <TableCell className="text-sm">{c.file}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {c.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data.low_bitrate.length > 0 && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3 text-yellow-500">
                Low Bitrate Files ({data.low_bitrate.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Bitrate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.low_bitrate.slice(0, 100).map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.artist}</TableCell>
                      <TableCell>{l.album}</TableCell>
                      <TableCell className="text-sm">{l.file}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {l.bitrate_kbps}k
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.low_bitrate.length > 100 && (
                <p className="text-muted-foreground text-sm mt-2">
                  ...and {data.low_bitrate.length - 100} more
                </p>
              )}
            </div>
          )}

          {data.lossy_with_lossless.length > 0 && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3 text-orange-500">
                Lossy Albums with Lossless Available (
                {data.lossy_with_lossless.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Lossy Album</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Lossless Version</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lossy_with_lossless.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.artist}</TableCell>
                      <TableCell>{l.lossy_album}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.lossy_formats.join(", ")}
                      </TableCell>
                      <TableCell className="text-green-500">
                        {l.lossless_album}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data.mixed_format_albums.length > 0 && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3">
                Mixed Format Albums ({data.mixed_format_albums.length})
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>Formats</TableHead>
                    <TableHead>Tracks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.mixed_format_albums.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.artist}</TableCell>
                      <TableCell>{m.album}</TableCell>
                      <TableCell>
                        {m.formats.map((f) => (
                          <Badge key={f} variant="outline" className="mr-1 text-[10px]">
                            {f.replace(".", "").toUpperCase()}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.track_count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!data.corrupt.length &&
            !data.low_bitrate.length &&
            !data.lossy_with_lossless.length &&
            !data.mixed_format_albums.length && (
              <div className="text-center py-12 text-green-500">
                Library quality is excellent!
              </div>
            )}
        </>
      )}
    </div>
  );
}
