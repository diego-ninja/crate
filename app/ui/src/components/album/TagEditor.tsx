import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface Track {
  filename: string;
  title?: string;
  tracknumber?: string;
  artist?: string;
}

interface TagEditorProps {
  artist: string;
  album: string;
  tags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  };
  tracks?: Track[];
  onSaved?: () => void;
}

export function TagEditor({ artist, album, tags, tracks, onSaved }: TagEditorProps) {
  const [values, setValues] = useState({
    artist: tags.artist || "",
    albumartist: tags.artist || "",
    album: tags.album || "",
    date: tags.year || "",
    genre: tags.genre || "",
  });
  const [trackEdits, setTrackEdits] = useState<Record<string, { title?: string; tracknumber?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [showTracks, setShowTracks] = useState(true);
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);

  useEffect(() => {
    api<{ name: string; count: number }[]>("/api/genres")
      .then((d) => { if (Array.isArray(d)) setAvailableGenres(d.map((g) => g.name).slice(0, 50)); })
      .catch(() => {});
  }, []);

  const currentGenres = values.genre
    .split(",")
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  function addGenre(g: string) {
    const lower = g.toLowerCase();
    if (!currentGenres.includes(lower)) {
      const updated = [...currentGenres, lower].join(", ");
      setValues({ ...values, genre: updated });
    }
  }

  function removeGenre(g: string) {
    const updated = currentGenres.filter((x) => x !== g).join(", ");
    setValues({ ...values, genre: updated });
  }

  function updateTrack(filename: string, field: string, value: string) {
    setTrackEdits((prev) => ({
      ...prev,
      [filename]: { ...prev[filename], [field]: value },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...values };
      if (Object.keys(trackEdits).length > 0) {
        body.tracks = trackEdits;
      }
      const { task_id } = await api<{ task_id: string }>(
        `/api/tags/${encPath(artist)}/${encPath(album)}`,
        "PUT",
        body,
      );
      toast.success("Saving tags...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: { updated?: number } }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setSaving(false);
            toast.success(`Tags saved (${task.result?.updated ?? 0} tracks)`);
            onSaved?.();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setSaving(false);
            toast.error("Failed to save tags");
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setSaving(false); }, 60000);
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "Unknown"}`);
      setSaving(false);
    }
  }

  function field(label: string, key: keyof typeof values) {
    return (
      <div className="flex gap-3 items-center mb-3">
        <label className="w-[100px] text-sm text-muted-foreground text-right flex-shrink-0">
          {label}
        </label>
        <Input
          value={values[key]}
          onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          className="bg-input border-border"
        />
      </div>
    );
  }

  const suggestedGenres = availableGenres.filter(
    (g) => !currentGenres.includes(g.toLowerCase()),
  );

  return (
    <div className="bg-card border border-border rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Album Tags</h3>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Tags"}
        </Button>
      </div>
      {field("Artist", "artist")}
      {field("Album Artist", "albumartist")}
      {field("Album", "album")}
      {field("Year", "date")}

      {/* Genre with badges */}
      <div className="flex gap-3 items-start mb-3">
        <label className="w-[100px] text-sm text-muted-foreground text-right flex-shrink-0 pt-2">
          Genres
        </label>
        <div className="flex-1">
          <div className="flex gap-1.5 flex-wrap mb-2">
            {currentGenres.map((g) => (
              <Badge key={g} variant="default" className="text-xs gap-1 pr-1">
                {g}
                <button onClick={() => removeGenre(g)} className="hover:text-destructive">
                  <X size={12} />
                </button>
              </Badge>
            ))}
          </div>
          <Input
            value={values.genre}
            onChange={(e) => setValues({ ...values, genre: e.target.value })}
            className="bg-input border-border mb-2"
            placeholder="Comma-separated genres"
          />
          {suggestedGenres.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {suggestedGenres.slice(0, 20).map((g) => (
                <Badge
                  key={g}
                  variant="outline"
                  className="text-[10px] cursor-pointer hover:bg-primary/20"
                  onClick={() => addGenre(g)}
                >
                  + {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Track-level editing */}
      {tracks && tracks.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <button
            className="flex items-center gap-2 text-sm font-medium hover:text-foreground mb-3"
            onClick={() => setShowTracks(!showTracks)}
          >
            {showTracks ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Track Tags ({tracks.length})
          </button>
          {showTracks && (
            <div className="space-y-1.5">
              <div className="flex gap-2 items-center text-[10px] text-muted-foreground uppercase tracking-wider px-1 mb-1">
                <span className="w-16">#</span>
                <span className="flex-1">Title</span>
                <span className="w-[120px] text-right hidden sm:block">File</span>
              </div>
              {tracks.map((t) => {
                const edits = trackEdits[t.filename] || {};
                const modified = edits.title !== undefined || edits.tracknumber !== undefined;
                return (
                  <div key={t.filename} className={`flex gap-2 items-center rounded-md px-1 py-0.5 ${modified ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}>
                    <Input
                      className="w-16 bg-input border-border text-xs text-center"
                      value={edits.tracknumber ?? t.tracknumber ?? ""}
                      onChange={(e) => updateTrack(t.filename, "tracknumber", e.target.value)}
                      placeholder="#"
                    />
                    <Input
                      className="flex-1 bg-input border-border text-sm"
                      value={edits.title ?? t.title ?? ""}
                      onChange={(e) => updateTrack(t.filename, "title", e.target.value)}
                      placeholder="Track title"
                    />
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px] hidden sm:block">
                      {t.filename.split("/").pop()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
