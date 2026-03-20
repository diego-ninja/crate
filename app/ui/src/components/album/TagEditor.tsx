import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";

interface TagEditorProps {
  artist: string;
  album: string;
  tags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  };
  onSaved?: () => void;
}

export function TagEditor({
  artist,
  album,
  tags,
  onSaved,
}: TagEditorProps) {
  const [values, setValues] = useState({
    artist: tags.artist || "",
    albumartist: tags.artist || "",
    album: tags.album || "",
    date: tags.year || "",
    genre: tags.genre || "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        `/api/tags/${encPath(artist)}/${encPath(album)}`,
        "PUT",
        values,
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
      toast.error(`Failed to save tags: ${e instanceof Error ? e.message : "Unknown error"}`);
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
      {field("Genre", "genre")}
    </div>
  );
}
