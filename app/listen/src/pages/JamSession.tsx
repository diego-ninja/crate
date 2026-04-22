import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Power,
  QrCode,
  Radio,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppModal, ModalBody, ModalCloseButton, ModalHeader } from "@crate-ui/primitives/AppModal";
import { QrCodeImage } from "@crate-ui/primitives/QrCodeImage";
import { useAuth } from "@/contexts/AuthContext";
import { type Track, usePlayer } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api, apiWsUrl } from "@/lib/api";

interface JamMember {
  room_id: string;
  user_id: number;
  role: "host" | "collab";
  joined_at: string;
  last_seen_at: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
}

interface JamEvent {
  id: number;
  room_id: string;
  user_id: number | null;
  event_type: string;
  payload_json?: Record<string, unknown> | null;
  created_at: string;
}

interface JamRoom {
  id: string;
  host_user_id: number;
  name: string;
  status: string;
  current_track_payload?: Record<string, unknown> | null;
  created_at: string;
  ended_at?: string | null;
  members: JamMember[];
  events: JamEvent[];
}

interface JamInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

function trackToPayload(track: Track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId,
    artistSlug: track.artistSlug,
    album: track.album,
    albumId: track.albumId,
    albumSlug: track.albumSlug,
    albumCover: track.albumCover,
    path: track.path,
    libraryTrackId: track.libraryTrackId,
  };
}

function payloadToTrack(payload: Record<string, unknown> | null | undefined): Track | null {
  if (!payload) return null;
  const id = typeof payload.id === "string" ? payload.id : typeof payload.path === "string" ? payload.path : null;
  if (!id) return null;
  return {
    id,
    title: typeof payload.title === "string" ? payload.title : "Unknown",
    artist: typeof payload.artist === "string" ? payload.artist : "",
    artistId: typeof payload.artistId === "number" ? payload.artistId : undefined,
    artistSlug: typeof payload.artistSlug === "string" ? payload.artistSlug : undefined,
    album: typeof payload.album === "string" ? payload.album : undefined,
    albumId: typeof payload.albumId === "number" ? payload.albumId : undefined,
    albumSlug: typeof payload.albumSlug === "string" ? payload.albumSlug : undefined,
    albumCover: typeof payload.albumCover === "string" ? payload.albumCover : undefined,
    path: typeof payload.path === "string" ? payload.path : undefined,
    libraryTrackId: typeof payload.libraryTrackId === "number" ? payload.libraryTrackId : undefined,
  };
}

function extractInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const marker = "/jam/invite/";
  const index = trimmed.indexOf(marker);
  if (index >= 0) {
    return trimmed.slice(index + marker.length).replace(/^\/+/, "");
  }
  return trimmed.replace(/^\/+/, "");
}

function reorderTracks(tracks: Track[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tracks.length || toIndex >= tracks.length) {
    return tracks;
  }
  const next = [...tracks];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return tracks;
  next.splice(toIndex, 0, item);
  return next;
}

function deriveSharedQueue(events: JamEvent[]) {
  let queue: Track[] = [];
  for (const event of events) {
    const payload = (event.payload_json || {}) as Record<string, unknown>;
    if (event.event_type === "queue_add") {
      const track = payloadToTrack(payload.track as Record<string, unknown> | undefined);
      if (track) queue = [...queue, track];
    } else if (event.event_type === "queue_remove" && typeof payload.index === "number") {
      queue = queue.filter((_, index) => index !== payload.index);
    } else if (
      event.event_type === "queue_reorder"
      && typeof payload.fromIndex === "number"
      && typeof payload.toIndex === "number"
    ) {
      queue = reorderTracks(queue, payload.fromIndex as number, payload.toIndex as number);
    }
  }
  return queue;
}

export function JamSession() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const {
    currentTrack,
    currentTime,
    isPlaying,
    play,
    playAll,
    pause,
    resume,
    seek,
  } = usePlayer();
  const { data, loading, error } = useApi<JamRoom>(
    roomId ? `/api/jam/rooms/${roomId}` : null,
  );
  const [room, setRoom] = useState<JamRoom | null>(null);
  const [sharedQueue, setSharedQueue] = useState<Track[]>([]);
  const [roomName, setRoomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteData, setInviteData] = useState<JamInvite | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const roomNameRef = useRef<string>("Jam session");

  useEffect(() => {
    if (data) {
      setRoom(data);
      setSharedQueue(deriveSharedQueue(data.events || []));
      roomNameRef.current = data.name;
    }
  }, [data]);

  const isHost = useMemo(() => {
    return Boolean(room && user && room.host_user_id === user.id);
  }, [room, user]);

  const myRole = useMemo(() => {
    if (!room || !user) return null;
    return room.members.find((member) => member.user_id === user.id)?.role || null;
  }, [room, user]);

  const roomIsActive = room?.status === "active";
  const canEditQueue = roomIsActive && (myRole === "host" || myRole === "collab");
  const roomCurrentTrack = payloadToTrack(room?.current_track_payload?.track as Record<string, unknown> | undefined);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let retries = 0;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    function connect() {
      if (cancelled) return;
      const socket = new WebSocket(apiWsUrl(`/api/jam/rooms/${roomId}/ws`));
      socketRef.current = socket;

      socket.onopen = () => {
        retries = 0;
        // Heartbeat every 30s to keep connection alive (mobile kills idle sockets)
        heartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            room?: JamRoom;
            event?: JamEvent;
            members?: JamMember[];
          };

          // Ignore pong responses
          if (payload.type === "pong") return;

          if (payload.type === "state_sync" && payload.room) {
            setRoom(payload.room);
            setSharedQueue(deriveSharedQueue(payload.room.events || []));
            roomNameRef.current = payload.room.name;
            return;
          }

          if (payload.type === "room_ended" && payload.room) {
            setRoom(payload.room);
            toast.info("This jam room has ended");
            return;
          }

          if (payload.type === "presence") {
            setRoom((prev) => prev ? { ...prev, members: payload.members || prev.members } : prev);
            return;
          }

          if (!payload.event) return;

          const eventRow = payload.event;
          const eventPayload = (eventRow.payload_json || {}) as Record<string, unknown>;
          const eventTrack = payloadToTrack(eventPayload.track as Record<string, unknown> | undefined);

          setRoom((prev) => {
            if (!prev) return prev;
            const nextRoom = {
              ...prev,
              members: payload.members || prev.members,
              events: [...prev.events, eventRow].slice(-80),
            };
            if (payload.type === "play" || payload.type === "pause" || payload.type === "seek") {
              nextRoom.current_track_payload = {
                track: eventPayload.track,
                position: eventPayload.position,
                playing: eventPayload.playing,
              };
            }
            return nextRoom;
          });

          if (payload.type === "queue_add" && eventTrack) {
            setSharedQueue((prev) => [...prev, eventTrack]);
          } else if (payload.type === "queue_remove" && typeof eventPayload.index === "number") {
            setSharedQueue((prev) => prev.filter((_, index) => index !== eventPayload.index));
          } else if (
            payload.type === "queue_reorder"
            && typeof eventPayload.fromIndex === "number"
            && typeof eventPayload.toIndex === "number"
          ) {
            setSharedQueue((prev) => reorderTracks(prev, eventPayload.fromIndex as number, eventPayload.toIndex as number));
          }

          if (eventRow.user_id === user?.id) return;

          if (payload.type === "play") {
            if (eventTrack) {
              play(eventTrack, { type: "queue", name: `Jam: ${roomNameRef.current}` });
            } else {
              resume();
            }
            if (typeof eventPayload.position === "number") {
              window.setTimeout(() => seek(eventPayload.position as number), 90);
            }
          } else if (payload.type === "pause") {
            if (typeof eventPayload.position === "number") {
              seek(eventPayload.position as number);
            }
            pause();
          } else if (payload.type === "seek" && typeof eventPayload.position === "number") {
            seek(eventPayload.position as number);
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        window.clearInterval(heartbeatTimer);

        // Don't reconnect if room ended or component unmounting
        if (event.code === 4409) {
          setRoom((prev) => prev ? { ...prev, status: "ended" } : prev);
          return;
        }
        if (cancelled) return;

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
        retries++;
        console.debug(`[jam] WebSocket closed, reconnecting in ${delay}ms (attempt ${retries})`);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // onclose will fire after this — reconnect logic lives there
      };
    }

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeatTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [pause, play, resume, roomId, seek, user?.id]);

  async function handleCreateRoom() {
    const name = roomName.trim();
    if (!name) {
      toast.error("Room name is required");
      return;
    }
    setCreating(true);
    try {
      const created = await api<JamRoom>("/api/jam/rooms", "POST", { name });
      navigate(`/jam/rooms/${created.id}`);
    } catch {
      toast.error("Failed to create jam room");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateInvite() {
    if (!room) return;
    setCreatingInvite(true);
    try {
      const invite = await api<JamInvite>(`/api/jam/rooms/${room.id}/invites`, "POST", {});
      setInviteData(invite);
      setInviteModalOpen(true);
    } catch {
      toast.error("Failed to create invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleEndRoom() {
    if (!room || !isHost) return;
    setEndingRoom(true);
    try {
      const updated = await api<JamRoom>(`/api/jam/rooms/${room.id}/end`, "POST", {});
      setRoom(updated);
      toast.success("Jam room ended");
    } catch {
      toast.error("Failed to end jam room");
    } finally {
      setEndingRoom(false);
    }
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  }

  function sendEvent(payload: Record<string, unknown>) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Room connection is not ready yet");
      return false;
    }
    socketRef.current.send(JSON.stringify(payload));
    return true;
  }

  function shareCurrentTrack() {
    if (!canEditQueue) {
      toast.error("You do not have permission to edit this room queue");
      return;
    }
    if (!currentTrack) {
      toast.info("Play something first so the room has a seed track");
      return;
    }
    if (sendEvent({
      type: "queue_add",
      track: trackToPayload(currentTrack),
      source: "current_track",
    })) {
      toast.success(`Shared ${currentTrack.title} with the room`);
    }
  }

  function syncPlaybackState() {
    if (!currentTrack) {
      toast.info("There is no current track to sync");
      return;
    }
    if (sendEvent({
      type: isPlaying ? "play" : "pause",
      track: trackToPayload(currentTrack),
      position: currentTime,
      playing: isPlaying,
    })) {
      toast.success(isPlaying ? "Playback synced to the room" : "Pause state synced to the room");
    }
  }

  function handlePlayRoomQueue() {
    if (sharedQueue.length === 0) {
      toast.info("The room queue is empty");
      return;
    }
    playAll(sharedQueue, 0, {
      type: "queue",
      name: `Jam: ${room?.name || "Session"}`,
    });
    toast.success("Room queue loaded into your player");
  }

  function handleRemoveFromRoomQueue(index: number) {
    if (!canEditQueue) {
      toast.error("You do not have permission to edit this room queue");
      return;
    }
    sendEvent({ type: "queue_remove", index });
  }

  function handleMoveInRoomQueue(fromIndex: number, toIndex: number) {
    if (!canEditQueue) {
      toast.error("You do not have permission to edit this room queue");
      return;
    }
    if (toIndex < 0 || toIndex >= sharedQueue.length) return;
    sendEvent({ type: "queue_reorder", fromIndex, toIndex });
  }

  if (!roomId) {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
          <h1 className="text-3xl font-bold text-foreground">Jam sessions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create a private room, invite collaborators with a link or QR, and keep a shared queue moving together.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Start a room</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Good for listening parties, queue handoffs, or testing new shared flows with a small group.
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Friday night queue"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none focus:border-cyan-400/40"
              />
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />}
                Create room
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">Join from invite</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste a full invite link or just the token.
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                placeholder="https://…/jam/invite/abc123"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none focus:border-cyan-400/40"
              />
              <button
                type="button"
                onClick={() => {
                  const token = extractInviteToken(inviteInput);
                  if (!token) {
                    toast.error("Paste a valid invite link or token");
                    return;
                  }
                  navigate(`/jam/invite/${token}`);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
              >
                <Users size={15} />
                Join room
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-foreground">Room unavailable</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {error || "You may not have access to this room anymore, or the invite has expired."}
        </p>
        <Link
          to="/jam"
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
        >
          Back to jam sessions
        </Link>
      </div>
    );
  }

  const inviteLink = inviteData ? `${window.location.origin}${inviteData.join_url}` : null;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300/75">Jam room</div>
            <h1 className="mt-1 text-3xl font-bold text-foreground">{room.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {room.members.length} member{room.members.length !== 1 ? "s" : ""} in the room.
              {" "}Use invites to bring people in, then sync playback or shape the shared queue together.
            </p>
            {!roomIsActive ? (
              <div className="mt-3 inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                Room ended
              </div>
            ) : null}
            {roomCurrentTrack ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Now playing in room</div>
                <div className="mt-1 text-sm font-medium text-foreground">{roomCurrentTrack.title}</div>
                <div className="text-xs text-muted-foreground">
                  {roomCurrentTrack.artist}
                  {roomCurrentTrack.album ? ` · ${roomCurrentTrack.album}` : ""}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {isHost ? (
              <button
                type="button"
                onClick={handleCreateInvite}
                disabled={creatingInvite || !roomIsActive}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {creatingInvite ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
                Invite people
              </button>
            ) : null}
            {isHost ? (
              <button
                type="button"
                onClick={handleEndRoom}
                disabled={endingRoom || !roomIsActive}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-200 hover:bg-red-500/15 transition-colors disabled:opacity-50"
              >
                {endingRoom ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                End room
              </button>
            ) : null}
            <button
              type="button"
              onClick={shareCurrentTrack}
              disabled={!roomIsActive}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <Users size={15} />
              Add current track
            </button>
            <button
              type="button"
              onClick={handlePlayRoomQueue}
              disabled={sharedQueue.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <ListMusic size={15} />
              Play room queue
            </button>
            <button
              type="button"
              onClick={syncPlaybackState}
              disabled={!isHost || !roomIsActive}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
            >
              {isPlaying ? <Play size={15} /> : <Pause size={15} />}
              Sync playback
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.1fr_1.1fr]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Members</h2>
          <div className="mt-4 space-y-3">
            {room.members.map((member) => (
              <Link
                key={`${member.room_id}-${member.user_id}`}
                to={member.username ? `/users/${member.username}` : "/people"}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {member.display_name || member.username || `User ${member.user_id}`}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {member.username ? `@${member.username}` : "Profile"} · {member.role}
                  </div>
                </div>
                <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                  {member.user_id === room.host_user_id ? "Host" : "Collab"}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Shared queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Host and collaborators can remove tracks and reorder the flow.
              </p>
            </div>
            <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
              {sharedQueue.length} track{sharedQueue.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {sharedQueue.map((track, index) => (
              <div
                key={`${track.id}-${index}`}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3"
              >
                <div className="w-6 text-center text-xs text-white/40">{index + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ""}
                  </div>
                </div>
                {canEditQueue ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveInRoomQueue(index, index - 1)}
                      disabled={index === 0}
                      className="rounded-full border border-white/10 p-1.5 text-muted-foreground hover:bg-white/5 disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveInRoomQueue(index, index + 1)}
                      disabled={index === sharedQueue.length - 1}
                      className="rounded-full border border-white/10 p-1.5 text-muted-foreground hover:bg-white/5 disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromRoomQueue(index)}
                      className="rounded-full border border-red-500/20 p-1.5 text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {sharedQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing in the shared queue yet. Add the current track or invite someone to start feeding it.
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Recent room activity</h2>
          <div className="mt-4 space-y-3">
            {[...room.events].reverse().slice(0, 20).map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{event.event_type.replace("_", " ")}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                {event.payload_json?.track && typeof event.payload_json.track === "object" ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {String((event.payload_json.track as Record<string, unknown>).title || "Unknown")}
                    {" · "}
                    {String((event.payload_json.track as Record<string, unknown>).artist || "Unknown artist")}
                  </div>
                ) : null}
              </div>
            ))}
            {room.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No room events yet.</p>
            ) : null}
          </div>
        </section>
      </div>

      <AppModal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} maxWidthClassName="sm:max-w-md">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Invite to room</h2>
            <p className="text-xs text-muted-foreground">Share this link or scan the QR to join.</p>
          </div>
          <ModalCloseButton onClick={() => setInviteModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          {inviteLink ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QrCodeImage
                  value={inviteLink}
                  size={210}
                  className="rounded-2xl border border-white/10 bg-[#0f1116] p-3"
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-muted-foreground break-all">
                {inviteLink}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteLink)}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Copy size={15} />
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyInviteLink(inviteLink);
                    setInviteModalOpen(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                >
                  <QrCode size={15} />
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </ModalBody>
      </AppModal>
    </div>
  );
}
