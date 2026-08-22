import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { AIButton } from "@/components/ui/AIButton";

import { api } from "@/lib/api";
import { artistActionApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

import type { ArtistData } from "./artistPageTypes";
import { ArtistGenreSelector } from "./ArtistGenreSelector";
import { ArtistBioResearchDialog } from "./ArtistBioResearchDialog";

interface ArtistMetadataEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistData;
  onSaved?: () => void;
}

interface ArtistMetadataFormState {
  bio: string;
  genres: string[];
  urls: string;
  mbid: string;
  country: string;
  area: string;
  formed: string;
  ended: string;
  artist_type: string;
  bandcamp_url: string;
}

function urlsToLines(urls: Record<string, string> | undefined) {
  return Object.entries(urls ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseUrls(value: string) {
  const urls: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const url = trimmed.slice(separatorIndex + 1).trim();
    if (key && url) urls[key] = url;
  }
  return urls;
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function initialState(artist: ArtistData): ArtistMetadataFormState {
  return {
    bio: artist.bio ?? "",
    genres: artist.manual_genres ?? [],
    urls: urlsToLines(artist.urls_json),
    mbid: artist.mbid ?? "",
    country: artist.country ?? "",
    area: artist.area ?? "",
    formed: artist.formed ?? "",
    ended: artist.ended ?? "",
    artist_type: artist.artist_type ?? "",
    bandcamp_url: artist.bandcamp_url ?? "",
  };
}

export function ArtistMetadataEditor({
  open,
  onOpenChange,
  artist,
  onSaved,
}: ArtistMetadataEditorProps) {
  const [values, setValues] = useState<ArtistMetadataFormState>(() =>
    initialState(artist),
  );
  const [saving, setSaving] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);

  useEffect(() => {
    if (open) setValues(initialState(artist));
  }, [artist, open]);

  function updateField<K extends keyof ArtistMetadataFormState>(
    key: K,
    value: ArtistMetadataFormState[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function closeEditor(nextOpen: boolean) {
    if (!nextOpen && !saving) {
      const dirty =
        JSON.stringify(values) !== JSON.stringify(initialState(artist));
      if (
        dirty &&
        !window.confirm("Discard unsaved artist metadata changes?")
      ) {
        return;
      }
    }
    onOpenChange(nextOpen);
  }

  async function save() {
    setSaving(true);
    try {
      const endpoint = artistActionApiPath(
        { artistId: artist.id, artistEntityUid: artist.entity_uid },
        "metadata",
      );
      if (!endpoint) throw new Error("Artist reference missing");

      const { task_id } = await api<{ task_id: string }>(endpoint, "PUT", {
        bio: blankToNull(values.bio),
        genres: values.genres,
        urls: parseUrls(values.urls),
        mbid: blankToNull(values.mbid),
        country: blankToNull(values.country),
        area: blankToNull(values.area),
        formed: blankToNull(values.formed),
        ended: blankToNull(values.ended),
        artist_type: blankToNull(values.artist_type),
        bandcamp_url: blankToNull(values.bandcamp_url),
      });

      toast.success("Saving artist metadata...");
      const task = await waitForTask(task_id, 60000);
      if (task.status === "completed") {
        toast.success("Artist metadata saved");
        onSaved?.();
        onOpenChange(false);
      } else {
        toast.error("Failed to save artist metadata");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={closeEditor}>
        <DialogContent className="max-h-[min(86vh,900px)] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Edit artist metadata</DialogTitle>
            <DialogDescription>
              Update descriptive library metadata for {artist.name}. Audio files
              are not modified by this action.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-6 overflow-y-auto py-2 pr-1">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-white/75">
                  Biography
                </span>
                <AIButton
                  type="button"
                  onClick={() => setResearchOpen(true)}
                  disabled={saving}
                >
                  Research with AI
                </AIButton>
              </div>
              <Textarea
                aria-label="Bio"
                value={values.bio}
                onChange={(event) => updateField("bio", event.target.value)}
                rows={5}
                maxLength={4000}
              />
              <div className="text-right text-xs text-white/35">
                {values.bio.length}/4000
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-white/75">Genres</h3>
                <p className="mt-1 text-xs text-white/40">
                  Choose canonical taxonomy genres. Provider tags remain stored
                  separately.
                </p>
              </div>
              <ArtistGenreSelector
                value={values.genres}
                onChange={(genres) => updateField("genres", genres)}
                disabled={saving}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-white/75">Identity</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">MusicBrainz ID</span>
                  <Input
                    value={values.mbid}
                    onChange={(event) =>
                      updateField("mbid", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Bandcamp URL</span>
                  <Input
                    value={values.bandcamp_url}
                    onChange={(event) =>
                      updateField("bandcamp_url", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Country</span>
                  <Input
                    value={values.country}
                    onChange={(event) =>
                      updateField("country", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Area</span>
                  <Input
                    value={values.area}
                    onChange={(event) =>
                      updateField("area", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Formed</span>
                  <Input
                    value={values.formed}
                    onChange={(event) =>
                      updateField("formed", event.target.value)
                    }
                    placeholder="1998"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Ended</span>
                  <Input
                    value={values.ended}
                    onChange={(event) =>
                      updateField("ended", event.target.value)
                    }
                    placeholder="optional"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Type</span>
                  <select
                    value={values.artist_type}
                    onChange={(event) =>
                      updateField("artist_type", event.target.value)
                    }
                    className="h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white"
                  >
                    <option value="">Not specified</option>
                    <option value="Group">Group</option>
                    <option value="Person">Person</option>
                    <option value="Character">Character</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-white/75">
                  External links
                </h3>
                <p className="mt-1 text-xs text-white/40">
                  One per line as label=https://…
                </p>
              </div>
              <Textarea
                aria-label="External URLs"
                value={values.urls}
                onChange={(event) => updateField("urls", event.target.value)}
                rows={4}
                placeholder="official=https://example.com"
              />
            </section>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeEditor(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? (
                <RefreshCw size={14} className="mr-2 animate-spin" />
              ) : null}
              Save metadata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ArtistBioResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        artist={artist}
        currentBio={values.bio}
        onApply={(bio) => updateField("bio", bio)}
      />
    </>
  );
}
