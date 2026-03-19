import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader2, Trash2, ListMusic, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Playlist {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  owner: string;
}

const SMART_TYPES = ["genre", "decade", "artist", "similar", "random"] as const;
type SmartType = (typeof SMART_TYPES)[number];

const DECADES = ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

export function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);

  // Smart playlist form
  const [smartType, setSmartType] = useState<SmartType>("genre");
  const [smartParam, setSmartParam] = useState("");
  const [smartName, setSmartName] = useState("");
  const [smartLimit, setSmartLimit] = useState(50);
  const [creating, setCreating] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    try {
      const data = await api<{ playlists: Playlist[] } | Playlist[]>("/api/navidrome/playlists");
      const list = Array.isArray(data) ? data : data?.playlists ?? [];
      setPlaylists(list);
    } catch {
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/navidrome/playlists/${deleteTarget.id}`, "DELETE");
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      fetchPlaylists();
    } catch {
      toast.error("Failed to delete playlist");
    }
  }

  async function handleCreateSmart() {
    setCreating(true);
    try {
      await api("/api/navidrome/playlists/smart", "POST", {
        strategy: smartType,
        param: smartParam,
        limit: smartLimit,
        name: smartName || `${smartType} mix`,
      });
      toast.success("Playlist created!");
      setSmartParam("");
      setSmartName("");
      fetchPlaylists();
    } catch {
      toast.error("Failed to create playlist");
    } finally {
      setCreating(false);
    }
  }

  function formatPlaylistDuration(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ListMusic size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Playlists</h1>
      </div>

      {/* Existing playlists */}
      <div className="mb-10">
        <h2 className="font-semibold mb-3">Navidrome Playlists</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : playlists.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No playlists found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Songs</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {playlists.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.songCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatPlaylistDuration(p.duration)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.owner}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(p)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Smart playlist generator */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={18} className="text-primary" />
          <h2 className="font-semibold">Smart Playlist Generator</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Type</label>
            <Select
              value={smartType}
              onValueChange={(v) => {
                setSmartType(v as SmartType);
                setSmartParam("");
              }}
            >
              <SelectTrigger className="bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="genre">Genre</SelectItem>
                <SelectItem value="decade">Decade</SelectItem>
                <SelectItem value="artist">Artist</SelectItem>
                <SelectItem value="similar">Similar Artists</SelectItem>
                <SelectItem value="random">Random</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {smartType === "decade" ? (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Decade</label>
              <Select value={smartParam} onValueChange={setSmartParam}>
                <SelectTrigger className="bg-card border-border">
                  <SelectValue placeholder="Select decade" />
                </SelectTrigger>
                <SelectContent>
                  {DECADES.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : smartType !== "random" ? (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {smartType === "genre" ? "Genre" : "Artist"}
              </label>
              <Input
                value={smartParam}
                onChange={(e) => setSmartParam(e.target.value)}
                placeholder={smartType === "genre" ? "e.g. rock" : "e.g. Radiohead"}
                className="bg-card border-border"
              />
            </div>
          ) : (
            <div />
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Limit</label>
            <Input
              type="number"
              value={smartLimit}
              onChange={(e) => setSmartLimit(Number(e.target.value) || 50)}
              min={1}
              max={500}
              className="bg-card border-border"
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Name</label>
            <Input
              value={smartName}
              onChange={(e) => setSmartName(e.target.value)}
              placeholder={`${smartType} mix`}
              className="bg-card border-border"
            />
          </div>
        </div>

        <Button
          className="mt-4"
          onClick={handleCreateSmart}
          disabled={creating || (smartType !== "random" && !smartParam)}
        >
          {creating ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1" />
              Creating...
            </>
          ) : (
            "Create Playlist"
          )}
        </Button>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Playlist"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
