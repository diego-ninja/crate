import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { GripVertical, ImagePlus, Loader2, Music2, Search, Upload, X } from "lucide-react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import { AppModal, ModalBody, ModalCloseButton, ModalFooter, ModalHeader } from "@crate-ui/primitives/AppModal";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

export interface PlaylistComposerTrack {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  path?: string;
  libraryTrackId?: number;
  playlistEntryId?: number;
  playlistPosition?: number;
}

interface SearchTrackResult {
  id: number;
  title: string;
  artist: string;
  album: string;
  path: string;
  duration: number;
}

interface PlaylistCreateModalProps {
  open: boolean;
  mode?: "create" | "edit";
  initialName?: string;
  initialDescription?: string;
  initialCoverDataUrl?: string | null;
  initialVisibility?: "public" | "private";
  initialCollaborative?: boolean;
  initialTracks: PlaylistComposerTrack[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) => Promise<void>;
}

function getTrackKey(track: PlaylistComposerTrack): string {
  if (track.libraryTrackId != null) return `id:${track.libraryTrackId}`;
  if (track.path) return `path:${track.path}`;
  return `${track.artist}:${track.album}:${track.title}`;
}

function SortableTrackItem({ track, onRemove }: { track: PlaylistComposerTrack; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: getTrackKey(track) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center justify-between gap-2 px-3 py-2.5">
      <button type="button" {...attributes} {...listeners} className="flex-shrink-0 cursor-grab text-white/20 hover:text-white/50 touch-none">
        <GripVertical size={14} />
      </button>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
          <Music2 size={15} className="text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{track.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {track.artist}{track.album ? ` · ${track.album}` : ""}{track.duration ? ` · ${formatDuration(track.duration)}` : ""}
          </div>
        </div>
      </div>
      <button type="button" className="rounded-full p-1.5 text-muted-foreground hover:text-white hover:bg-white/5 transition-colors" onClick={onRemove}>
        <X size={14} />
      </button>
    </div>
  );
}

function mergeUniqueTracks(tracks: PlaylistComposerTrack[]): PlaylistComposerTrack[] {
  const seen = new Set<string>();
  const result: PlaylistComposerTrack[] = [];
  for (const track of tracks) {
    const key = getTrackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function PlaylistCreateModal({
  open,
  mode = "create",
  initialName = "",
  initialDescription = "",
  initialCoverDataUrl = null,
  initialVisibility = "private",
  initialCollaborative = false,
  initialTracks,
  submitting,
  onClose,
  onSubmit,
}: PlaylistCreateModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"public" | "private">(initialVisibility);
  const [isCollaborative, setIsCollaborative] = useState(initialCollaborative);
  const [tracks, setTracks] = useState<PlaylistComposerTrack[]>(initialTracks);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchTrackResult[]>([]);
  const [titleEditing, setTitleEditing] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setCoverDataUrl(initialCoverDataUrl);
    setVisibility(initialVisibility);
    setIsCollaborative(initialCollaborative);
    setTracks(initialTracks);
    setSearch("");
    setResults([]);
    setTitleEditing(false);
    setDescriptionEditing(false);
  }, [initialCollaborative, initialCoverDataUrl, initialDescription, initialName, initialTracks, initialVisibility, open]);

  useEffect(() => {
    if (!open || !titleEditing) return;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, titleEditing]);

  useEffect(() => {
    if (!open || !descriptionEditing) return;
    const timer = window.setTimeout(() => descriptionInputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [descriptionEditing, open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = search.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api<{ tracks: SearchTrackResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) {
          setResults(response.tracks || []);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTracks((items) => {
      const oldIdx = items.findIndex((t) => getTrackKey(t) === active.id);
      const newIdx = items.findIndex((t) => getTrackKey(t) === over.id);
      return arrayMove(items, oldIdx, newIdx);
    });
  }, []);

  if (!open) return null;

  const isEditMode = mode === "edit";
  const modalTitle = isEditMode ? "Edit playlist" : "Create playlist";
  const modalSubtitle = isEditMode
    ? "Update details, cover and tracks."
    : "Add cover, description and tracks before saving.";
  const submitLabel = isEditMode ? "Save changes" : "Create playlist";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setCoverDataUrl(dataUrl);
    } catch {
      setCoverDataUrl(null);
    } finally {
      event.target.value = "";
    }
  }

  function addTrack(track: PlaylistComposerTrack) {
    setTracks((current) => mergeUniqueTracks([...current, track]));
  }

  function removeTrack(track: PlaylistComposerTrack) {
    const keyToRemove = getTrackKey(track);
    setTracks((current) => current.filter((item) => getTrackKey(item) !== keyToRemove));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    await onSubmit({
      name: trimmedName,
      description: description.trim(),
      coverDataUrl,
      visibility,
      isCollaborative,
      tracks,
    });
  }

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      maxWidthClassName="sm:max-w-3xl"
      closeOnEscape={!submitting}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[92vh]">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{modalTitle}</h2>
            <p className="text-xs text-muted-foreground">{modalSubtitle}</p>
          </div>
          <ModalCloseButton onClick={onClose} disabled={submitting} />
        </ModalHeader>

        <ModalBody className="space-y-5 px-5 py-5">
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <PlaylistArtwork
                name={name || "New Playlist"}
                coverDataUrl={coverDataUrl}
                tracks={tracks}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl shadow-2xl"
              />
              <button
                type="button"
                className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1 rounded-full bg-black/65 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur-md hover:bg-black/80 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={12} />
                Edit cover
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-3 pt-1">
              <div className="space-y-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                  Playlist
                </div>
                {titleEditing ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    placeholder="My next obsession"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => setTitleEditing(false)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full text-left text-xl font-semibold text-foreground hover:text-white transition-colors"
                    onClick={() => setTitleEditing(true)}
                  >
                    {name || "Add a title"}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                  Description
                </div>
                {descriptionEditing ? (
                  <textarea
                    ref={descriptionInputRef}
                    rows={3}
                    placeholder="Write something about this playlist"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => setDescriptionEditing(false)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full text-left text-sm leading-6 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setDescriptionEditing(true)}
                  >
                    {description || "Add a description"}
                  </button>
                )}
              </div>

              {coverDataUrl ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  onClick={() => setCoverDataUrl(null)}
                >
                  <ImagePlus size={14} />
                  Use collage instead
                </button>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${visibility === "private" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground"}`}
                  onClick={() => setVisibility("private")}
                >
                  Private
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${visibility === "public" ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground"}`}
                  onClick={() => setVisibility("public")}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${isCollaborative ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground"}`}
                  onClick={() => setIsCollaborative((current) => !current)}
                >
                  Collaborative
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <Search size={15} className="text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tracks to add"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {searching ? <Loader2 size={14} className="text-primary animate-spin" /> : null}
            </div>

            {search.trim().length >= 2 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5">
                {results.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto py-1.5">
                    {results.map((track) => (
                      <button
                        key={`${track.id}-${track.path}`}
                        type="button"
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                        onClick={() =>
                          addTrack({
                            title: track.title,
                            artist: track.artist,
                            album: track.album,
                            duration: track.duration,
                            path: track.path,
                            libraryTrackId: track.id,
                          })
                        }
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">{track.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {track.artist} · {track.album}
                          </div>
                        </div>
                        <span className="text-xs text-primary">Add</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No tracks found</div>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Tracks</h3>
                <p className="text-xs text-muted-foreground">
                  {tracks.length > 0 ? `${tracks.length} selected` : "Add tracks now or later."}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5">
              <div className="max-h-64 overflow-y-auto py-1.5">
                {tracks.length > 0 ? (
                  <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={tracks.map(getTrackKey)} strategy={verticalListSortingStrategy}>
                      {tracks.map((track) => (
                        <SortableTrackItem key={getTrackKey(track)} track={track} onRemove={() => removeTrack(track)} />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Start by searching for tracks or open this modal from an album or track menu.
                  </div>
                )}
              </div>
            </div>
          </div>
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {submitLabel}
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
