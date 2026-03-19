import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface PreviewTrack {
  current: string;
  proposed: string;
  changed: boolean;
}

interface PreviewData {
  tracks: PreviewTrack[];
  folder_current: string;
  folder_suggested: string;
  changes: number;
}

export function Organizer() {
  const [presets, setPresets] = useState<Record<string, string>>({});
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [pattern, setPattern] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    api<Record<string, string>>("/api/organize/presets").then((p) => {
      setPresets(p);
      const first = Object.values(p)[0];
      if (first) setPattern(first);
    });
  }, []);

  async function doPreview() {
    if (!artist.trim() || !album.trim()) return;
    const data = await api<PreviewData>(
      `/api/organize/preview/${encPath(artist.trim())}/${encPath(album.trim())}?pattern=${encodeURIComponent(pattern)}`,
    );
    setPreview(data);
  }

  async function apply(renameFolder: boolean) {
    const body: { pattern: string; rename_folder?: string } = { pattern };
    if (renameFolder && preview) {
      body.rename_folder = preview.folder_suggested;
    }
    await api(
      `/api/organize/apply/${encPath(artist.trim())}/${encPath(album.trim())}`,
      "POST",
      body,
    );
    doPreview();
  }

  return (
    <div>
      <h2 className="font-semibold mb-2">File Organizer</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Rename files and folders based on tags.
      </p>
      <div className="flex gap-3 mb-4 items-end">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground block mb-1">
            Artist
          </label>
          <Input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist folder name"
            className="bg-input border-border"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-muted-foreground block mb-1">
            Album
          </label>
          <Input
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            placeholder="Album folder name"
            className="bg-input border-border"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Pattern
          </label>
          <Select value={pattern} onValueChange={setPattern}>
            <SelectTrigger className="w-[300px] bg-input border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(presets).map(([k, v]) => (
                <SelectItem key={k} value={v}>
                  {k}: {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={doPreview}>Preview</Button>
      </div>

      {preview && (
        <div>
          <div className="mb-4">
            <strong>Folder:</strong>{" "}
            <span className="text-muted-foreground">
              {preview.folder_current}
            </span>
            {preview.folder_current !== preview.folder_suggested ? (
              <>
                {" \u2192 "}
                <span className="text-green-500">
                  {preview.folder_suggested}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground"> (ok)</span>
            )}
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            {preview.changes} of {preview.tracks.length} files would be renamed
          </p>
          {preview.changes > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Current</TableHead>
                    <TableHead>Proposed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.tracks
                    .filter((t) => t.changed)
                    .map((t) => (
                      <TableRow key={t.current}>
                        <TableCell>
                          <span className="text-red-500 line-through text-sm">
                            {t.current}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-green-500 text-sm">
                            {t.proposed}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
                  onClick={() => apply(false)}
                >
                  Rename Files
                </Button>
                {preview.folder_current !== preview.folder_suggested && (
                  <Button
                    variant="outline"
                    className="border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
                    onClick={() => apply(true)}
                  >
                    Rename Files + Folder
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              All files already match the pattern
            </div>
          )}
        </div>
      )}
    </div>
  );
}
