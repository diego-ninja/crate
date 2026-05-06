import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Globe2,
  ListMusic,
  Loader2,
  Lock,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  QrCode,
  Radio,
  Search,
  Share2,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { AppModal, ModalBody, ModalCloseButton, ModalHeader } from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { useAuth } from "@/contexts/AuthContext";
import { type Track, usePlayerActions, usePlayerProgress, usePlayerState } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api, apiWsUrl } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  setPlaybackDeliveryPolicyPreference,
  type PlaybackDeliveryPolicy,
} from "@/lib/player-playback-prefs";

type JamVisibility = "public" | "private";

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
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

interface JamRoom {
  id: string;
  host_user_id: number;
  name: string;
  status: string;
  visibility: JamVisibility;
  is_permanent: boolean;
  description?: string | null;
  tags?: string[];
  current_track_payload?: Record<string, unknown> | null;
  created_at: string;
  ended_at?: string | null;
  member_count?: number | null;
  last_event_at?: string | null;
  members: JamMember[];
  events: JamEvent[];
}

interface JamRoomsResponse {
  rooms: JamRoom[];
}

interface JamInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

interface SearchTrack {
  id?: number;
  entity_uid?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  path?: string;
}

interface SearchData {
  tracks: SearchTrack[];
}

interface HeroActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

function HeroActionButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroActionButtonProps) {
  return (
    <ActionIconButton
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`h-11 w-11 border border-white/10 bg-white/[0.04] text-muted-foreground hover:border-white/20 hover:bg-white/[0.08] hover:text-foreground disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
    </ActionIconButton>
  );
}

function jamCloseMessage(code: number) {
  if (code === 4401) return "Your session is not valid anymore. Log in again to join this room.";
  if (code === 4403) return "You do not have access to this room, or the room is no longer active.";
  if (code === 4500) return "Room sync is temporarily unavailable. Retrying... (4500)";
  return `Room connection dropped. Retrying... (${code || "unknown"})`;
}

function shouldReconnectJamClose(code: number) {
  return ![4401, 4403, 4409].includes(code);
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

function searchTrackToTrack(track: SearchTrack): Track {
  return toPlayableTrack({
    ...track,
    library_track_id: typeof track.id === "number" ? track.id : undefined,
  }, {
    cover: track.album
      ? albumCoverApiUrl({
          albumId: track.album_id,
          albumEntityUid: track.album_entity_uid,
          artistEntityUid: track.artist_entity_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        })
      : undefined,
  });
}

function parseRoomTags(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 40));
    if (tags.length >= 12) break;
  }
  return tags;
}

function formatRoomTagsInput(tags: string[] | undefined | null) {
  return (tags || []).join(", ");
}

function displayName(person: { display_name?: string | null; username?: string | null; user_id?: number | null }) {
  const profileName = person.display_name?.trim();
  const username = person.username?.trim();
  return profileName || username || (person.user_id ? `User ${person.user_id}` : "Someone");
}

function resolveJamActor(
  event: JamEvent,
  members: JamMember[],
  currentUser?: { id: number; username?: string | null; name?: string | null; avatar?: string | null } | null,
) {
  const member = event.user_id == null ? null : members.find((candidate) => candidate.user_id === event.user_id);
  const ownUser = currentUser && event.user_id === currentUser.id ? currentUser : null;
  const actor = {
    user_id: event.user_id,
    username: event.username || member?.username || ownUser?.username || null,
    display_name: event.display_name || member?.display_name || ownUser?.name || null,
    avatar: event.avatar || member?.avatar || ownUser?.avatar || null,
  };
  return {
    name: displayName(actor),
    avatar: actor.avatar,
  };
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

function AvatarBubble({ name, avatar, size = "md" }: { name: string; avatar?: string | null; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-[11px]" : "h-11 w-11 text-xs";
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className={`${sizeClass} shrink-0 rounded-full border border-white/10 object-cover`}
      />
    );
  }
  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] font-semibold text-white/70`}>
      {initials(name)}
    </div>
  );
}

function eventActivityText(event: JamEvent, actorName?: string) {
  const actor = actorName || displayName(event);
  const payload = (event.payload_json || {}) as Record<string, unknown>;
  const track = payloadToTrack(payload.track as Record<string, unknown> | undefined);
  if (event.event_type === "join") return `${actor} joined the room`;
  if (event.event_type === "queue_add") return `${actor} added ${track?.title || "a track"} to the queue`;
  if (event.event_type === "queue_remove") return `${actor} removed a track from the queue`;
  if (event.event_type === "queue_reorder") return `${actor} reordered the queue`;
  if (event.event_type === "play") return `${actor} synced playback`;
  if (event.event_type === "pause") return `${actor} paused the room`;
  if (event.event_type === "seek") return `${actor} adjusted playback position`;
  if (event.event_type === "room_updated") return `${actor} updated room settings`;
  if (event.event_type === "room_ended") return `${actor} ended the room`;
  return `${actor} did ${event.event_type.replace("_", " ")}`;
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
  const { currentTime } = usePlayerProgress();
  const { isPlaying } = usePlayerState();
  const {
    currentTrack,
    play,
    playAll,
    pause,
    resume,
    seek,
  } = usePlayerActions();
  const [roomSearch, setRoomSearch] = useState("");
  const deferredRoomSearch = useDeferredValue(roomSearch);
  const roomsUrl = !roomId
    ? `/api/jam/rooms${deferredRoomSearch.trim() ? `?q=${encodeURIComponent(deferredRoomSearch.trim())}` : ""}`
    : null;
  const { data, loading, error } = useApi<JamRoom>(
    roomId ? `/api/jam/rooms/${roomId}` : null,
  );
  const {
    data: roomsData,
    loading: roomsLoading,
    refetch: refetchRooms,
  } = useApi<JamRoomsResponse>(
    roomsUrl,
    "GET",
    undefined,
    { safetyNetMs: 5_000 },
  );
  const [room, setRoom] = useState<JamRoom | null>(null);
  const [sharedQueue, setSharedQueue] = useState<Track[]>([]);
  const [roomName, setRoomName] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [roomTagsInput, setRoomTagsInput] = useState("");
  const [roomVisibility, setRoomVisibility] = useState<JamVisibility>("private");
  const [roomPermanent, setRoomPermanent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteData, setInviteData] = useState<JamInvite | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataTagsInput, setMetadataTagsInput] = useState("");
  const [endingRoom, setEndingRoom] = useState(false);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [deleteTargetRoom, setDeleteTargetRoom] = useState<JamRoom | null>(null);
  const [updatingRoomField, setUpdatingRoomField] = useState<"visibility" | "permanent" | "metadata" | null>(null);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueSearchResults, setQueueSearchResults] = useState<SearchTrack[]>([]);
  const [queueSearchLoading, setQueueSearchLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "synced" | "drifting">("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionProblem, setConnectionProblem] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());
  const roomNameRef = useRef<string>("Jam session");

  const playerActionsRef = useRef({ play, playAll, pause, resume, seek, currentTrack });
  playerActionsRef.current = { play, playAll, pause, resume, seek, currentTrack };
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const prevQualityRef = useRef<PlaybackDeliveryPolicy | null>(null);

  useEffect(() => {
    if (roomId) {
      const current = getPlaybackDeliveryPolicyPreference();
      if (current !== "original") {
        prevQualityRef.current = current;
        setPlaybackDeliveryPolicyPreference("original");
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, { detail: { playbackDeliveryPolicy: "original" } })
        );
      }
    }
    return () => {
      if (prevQualityRef.current) {
        setPlaybackDeliveryPolicyPreference(prevQualityRef.current);
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, { detail: { playbackDeliveryPolicy: prevQualityRef.current } })
        );
        prevQualityRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (data) {
      setRoom(data);
      setSharedQueue(deriveSharedQueue(data.events || []));
      seenEventIdsRef.current = new Set((data.events || []).map((event) => event.id).filter(Boolean));
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
  const visibleRooms = roomsData?.rooms || [];
  const { memberRooms, publicRooms } = useMemo(() => {
    const mine: JamRoom[] = [];
    const discoverable: JamRoom[] = [];
    for (const listedRoom of visibleRooms) {
      const isMember = listedRoom.members.some((member) => member.user_id === user?.id);
      if (isMember) {
        mine.push(listedRoom);
      } else if (listedRoom.visibility === "public") {
        discoverable.push(listedRoom);
      }
    }
    return { memberRooms: mine, publicRooms: discoverable };
  }, [user?.id, visibleRooms]);

  useEffect(() => {
    const query = queueSearch.trim();
    if (!roomId || !canEditQueue || query.length < 2) {
      setQueueSearchResults([]);
      setQueueSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQueueSearchLoading(true);
      api<SearchData>(
        `/api/search?q=${encodeURIComponent(query)}&limit=8`,
        "GET",
        undefined,
        { signal: controller.signal },
      )
        .then((result) => setQueueSearchResults(result.tracks || []))
        .catch(() => {
          if (!controller.signal.aborted) setQueueSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setQueueSearchLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canEditQueue, queueSearch, roomId]);

  const sendEvent = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const message = connectionProblem || "Room connection dropped. Retrying... (not open)";
      setIsConnected(false);
      setConnectionProblem(message);
      toast.error(message);
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, [connectionProblem]);

  const syncSeek = useCallback((track: Record<string, unknown> | null | undefined, positionMs: number) => {
    const targetTrack = payloadToTrack(track);
    const { currentTrack: ct, seek: sk } = playerActionsRef.current;
    const currentPositionMs = currentTimeRef.current * 1000;

    if (targetTrack && ct && (targetTrack.id === ct.id || targetTrack.path === ct.path)) {
      const drift = Math.abs(positionMs - currentPositionMs);
      if (drift > 200) {
        sk(positionMs / 1000);
      }
      if (drift < 100) {
        setSyncStatus("synced");
      } else {
        setSyncStatus("drifting");
      }
    } else if (targetTrack) {
      setSyncStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (!roomId || !user) return;
    let cancelled = false;
    let retries = 0;
    let reconnectTimer: number | undefined;
    const heartbeatTimers = new Set<number>();

    function clearHeartbeat(timer: number | undefined) {
      if (timer === undefined) return;
      window.clearInterval(timer);
      heartbeatTimers.delete(timer);
    }

    function connect() {
      if (cancelled) return;
      setSyncStatus("idle");
      setConnectionProblem(null);
      const socket = new WebSocket(apiWsUrl(`/api/jam/rooms/${roomId}/ws`));
      let socketHeartbeatTimer: number | undefined;
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled || socketRef.current !== socket) {
          socket.close();
          return;
        }
        retries = 0;
        setIsConnected(true);
        setConnectionProblem(null);
        socketHeartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
        heartbeatTimers.add(socketHeartbeatTimer);
      };

      socket.onmessage = (event) => {
        if (cancelled || socketRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            room?: JamRoom;
            event?: JamEvent;
            members?: JamMember[];
            track?: Record<string, unknown>;
            position_ms?: number;
            playing?: boolean;
            detail?: string;
          };

          if (payload.type === "pong") return;

          if (payload.type === "warning") {
            if (payload.detail) toast.info(payload.detail);
            return;
          }

          if (payload.type === "sync_clock" && typeof payload.position_ms === "number") {
            syncSeek(payload.track, payload.position_ms);
            return;
          }

          if (payload.type === "state_sync" && payload.room) {
            setRoom(payload.room);
            setSharedQueue(deriveSharedQueue(payload.room.events || []));
            seenEventIdsRef.current = new Set((payload.room.events || []).map((roomEvent) => roomEvent.id).filter(Boolean));
            roomNameRef.current = payload.room.name;
            return;
          }

          if (payload.type === "room_ended" && payload.room) {
            setRoom(payload.room);
            setSyncStatus("idle");
            setConnectionProblem(null);
            toast.info("This jam room has ended");
            return;
          }

          if (payload.type === "room_deleted") {
            setSyncStatus("idle");
            setConnectionProblem(null);
            toast.info("This jam room was deleted");
            navigate("/jam", { replace: true });
            return;
          }

          if (payload.type === "presence") {
            setRoom((prev) => prev ? { ...prev, members: payload.members || prev.members } : prev);
            return;
          }

          if (!payload.event) return;

          const eventRow = payload.event;
          if (eventRow.id && seenEventIdsRef.current.has(eventRow.id)) return;
          if (eventRow.id) seenEventIdsRef.current.add(eventRow.id);

          if (payload.type === "room_updated" && payload.room) {
            setRoom(payload.room);
            setSharedQueue(deriveSharedQueue(payload.room.events || []));
            roomNameRef.current = payload.room.name;
            toast.info("Room settings updated");
            return;
          }

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

          const { play: pl, pause: pa, resume: re, seek: sk } = playerActionsRef.current;

          if (payload.type === "play") {
            if (eventTrack) {
              pl(eventTrack, { type: "queue", name: `Jam: ${roomNameRef.current}` });
            } else {
              re();
            }
            if (typeof eventPayload.position === "number") {
              window.setTimeout(() => sk(eventPayload.position as number), 120);
            }
          } else if (payload.type === "pause") {
            if (typeof eventPayload.position === "number") {
              sk(eventPayload.position as number);
            }
            pa();
          } else if (payload.type === "seek" && typeof eventPayload.position === "number") {
            sk(eventPayload.position as number);
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = (event) => {
        clearHeartbeat(socketHeartbeatTimer);
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setIsConnected(false);
        setSyncStatus("idle");

        if (event.code === 4409) {
          setRoom((prev) => prev ? { ...prev, status: "ended" } : prev);
          setConnectionProblem(null);
          return;
        }
        if (cancelled) return;

        const message = jamCloseMessage(event.code);
        setConnectionProblem(message);
        if (!shouldReconnectJamClose(event.code)) {
          toast.error(message);
          return;
        }

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
      for (const timer of heartbeatTimers) {
        window.clearInterval(timer);
      }
      heartbeatTimers.clear();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [navigate, roomId, user?.id]);

  async function handleCreateRoom() {
    const name = roomName.trim();
    if (!name) {
      toast.error("Room name is required");
      return;
    }
    setCreating(true);
    try {
      const created = await api<JamRoom>("/api/jam/rooms", "POST", {
        name,
        visibility: roomVisibility,
        is_permanent: roomPermanent,
        description: roomDescription.trim() || null,
        tags: parseRoomTags(roomTagsInput),
      });
      navigate(`/jam/rooms/${created.id}`);
    } catch {
      toast.error("Failed to create jam room");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom(targetRoom: JamRoom) {
    if (targetRoom.members.some((member) => member.user_id === user?.id)) {
      navigate(`/jam/rooms/${targetRoom.id}`);
      return;
    }
    setJoiningRoomId(targetRoom.id);
    try {
      const joined = await api<{ room: JamRoom }>(`/api/jam/rooms/${targetRoom.id}/join`, "POST", {});
      refetchRooms();
      navigate(`/jam/rooms/${joined.room.id}`);
    } catch {
      toast.error("Failed to join jam room");
    } finally {
      setJoiningRoomId(null);
    }
  }

  async function updateRoomSettings(
    patch: Partial<Pick<JamRoom, "name" | "visibility" | "is_permanent" | "description" | "tags">>,
    field: "visibility" | "permanent" | "metadata",
  ) {
    if (!room || !isHost) return false;
    setUpdatingRoomField(field);
    try {
      const updated = await api<JamRoom>(`/api/jam/rooms/${room.id}`, "PATCH", patch);
      setRoom(updated);
      toast.success("Room settings updated");
      return true;
    } catch {
      toast.error("Failed to update room settings");
      return false;
    } finally {
      setUpdatingRoomField(null);
    }
  }

  function openMetadataModal() {
    if (!room) return;
    setMetadataDescription(room.description || "");
    setMetadataTagsInput(formatRoomTagsInput(room.tags));
    setMetadataModalOpen(true);
  }

  async function saveRoomMetadata() {
    const updated = await updateRoomSettings(
      {
        description: metadataDescription.trim() || null,
        tags: parseRoomTags(metadataTagsInput),
      },
      "metadata",
    );
    if (updated) setMetadataModalOpen(false);
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
      setSyncStatus("idle");
      toast.success("Jam room ended");
    } catch {
      toast.error("Failed to end jam room");
    } finally {
      setEndingRoom(false);
    }
  }

  function requestDeleteRoom(targetRoom: JamRoom) {
    if (targetRoom.host_user_id !== user?.id) return;
    setDeleteTargetRoom(targetRoom);
  }

  async function confirmDeleteRoom() {
    const targetRoom = deleteTargetRoom;
    if (!targetRoom || targetRoom.host_user_id !== user?.id) return;
    setDeletingRoomId(targetRoom.id);
    try {
      await api<{ ok: boolean; room_id: string }>(`/api/jam/rooms/${targetRoom.id}`, "DELETE");
      toast.success("Jam room deleted");
      refetchRooms();
      setDeleteTargetRoom(null);
      if (roomId === targetRoom.id) navigate("/jam", { replace: true });
    } catch {
      toast.error("Failed to delete jam room");
    } finally {
      setDeletingRoomId(null);
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

  function addSearchTrackToRoom(track: SearchTrack) {
    if (!canEditQueue) {
      toast.error("You do not have permission to edit this room queue");
      return;
    }
    const playable = searchTrackToTrack(track);
    if (sendEvent({
      type: "queue_add",
      track: trackToPayload(playable),
      source: "search",
    })) {
      toast.success(`Added ${playable.title} to the room queue`);
      setQueueSearch("");
      setQueueSearchResults([]);
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
      setSyncStatus(isPlaying ? "synced" : "idle");
      toast.success(
        isPlaying
          ? "Synced! Everyone is now listening together."
          : "Pause state synced to the room"
      );
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

  function renderRoomCard(listedRoom: JamRoom, mode: "member" | "public") {
    const isMember = listedRoom.members.some((member) => member.user_id === user?.id);
    const isHostRoom = listedRoom.host_user_id === user?.id;
    const latestEvent = [...(listedRoom.events || [])].reverse()[0];
    const latestActor = latestEvent ? resolveJamActor(latestEvent, listedRoom.members, user) : null;
    const isJoining = joiningRoomId === listedRoom.id;
    return (
      <div
        key={listedRoom.id}
        role="button"
        tabIndex={0}
        aria-label={`${isMember ? "Open" : "Join"} ${listedRoom.name}`}
        onClick={() => void handleJoinRoom(listedRoom)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void handleJoinRoom(listedRoom);
          }
        }}
        className="rounded-2xl border border-white/10 bg-black/15 p-4 cursor-pointer transition-colors hover:border-cyan-400/25 hover:bg-white/[0.035] focus:outline-none focus-visible:border-cyan-400/50 focus-visible:ring-2 focus-visible:ring-cyan-400/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">{listedRoom.name}</div>
            {listedRoom.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{listedRoom.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-muted-foreground">
                {listedRoom.visibility === "public" ? <Globe2 size={11} /> : <Lock size={11} />}
                {mode === "member" ? "Your room" : "Public"}
              </span>
              {listedRoom.is_permanent ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-cyan-200">
                  <Pin size={11} />
                  Permanent
                </span>
              ) : null}
              {listedRoom.status !== "active" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                  Paused
                </span>
              ) : null}
              {(listedRoom.tags || []).slice(0, 5).map((tag) => (
                <span key={`${listedRoom.id}-${tag}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-muted-foreground">
              {isJoining ? <Loader2 size={15} className="animate-spin text-cyan-300" /> : <Users size={15} />}
            </div>
            {isHostRoom ? (
              <div
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
              >
                <button
                  type="button"
                  onClick={() => requestDeleteRoom(listedRoom)}
                  disabled={deletingRoomId === listedRoom.id}
                  title="Delete room"
                  aria-label={`Delete ${listedRoom.name}`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-200 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                >
                  {deletingRoomId === listedRoom.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex -space-x-2">
            {listedRoom.members.slice(0, 5).map((member) => {
              const name = displayName(member);
              return (
                <AvatarBubble
                  key={`${listedRoom.id}-${member.user_id}`}
                  name={name}
                  avatar={member.avatar}
                  size="sm"
                />
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {listedRoom.member_count || listedRoom.members.length} member{(listedRoom.member_count || listedRoom.members.length) === 1 ? "" : "s"}
          </div>
        </div>
        {latestEvent ? (
          <div className="mt-3 truncate text-xs text-muted-foreground">
            {eventActivityText(latestEvent, latestActor?.name)}
          </div>
        ) : null}
      </div>
    );
  }

  const deleteRoomModal = (
    <AppModal
      open={deleteTargetRoom !== null}
      onClose={() => {
        if (!deletingRoomId) setDeleteTargetRoom(null);
      }}
      maxWidthClassName="sm:max-w-md"
    >
      <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Delete room</h2>
          <p className="text-xs text-muted-foreground">This removes the room, members, invites, queue, and activity.</p>
        </div>
        <ModalCloseButton onClick={() => {
          if (!deletingRoomId) setDeleteTargetRoom(null);
        }} />
      </ModalHeader>
      <ModalBody className="px-5 py-5">
        <div className="space-y-4">
          <div className="rounded-2xl border border-red-500/15 bg-red-500/10 px-4 py-3">
            <div className="text-sm font-medium text-foreground">{deleteTargetRoom?.name || "Room"}</div>
            <div className="mt-1 text-xs text-red-100/75">
              This action cannot be undone.
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTargetRoom(null)}
              disabled={Boolean(deletingRoomId)}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteRoom()}
              disabled={Boolean(deletingRoomId)}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/15 px-4 py-2.5 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            >
              {deletingRoomId ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Delete room
            </button>
          </div>
        </div>
      </ModalBody>
    </AppModal>
  );

  if (!roomId) {
    return (
      <>
      <div className="space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
          <h1 className="text-3xl font-bold text-foreground">Jam sessions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create invite-only rooms, open public listening rooms, or keep permanent spaces around for recurring sessions.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
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
              <textarea
                value={roomDescription}
                onChange={(event) => setRoomDescription(event.target.value)}
                placeholder="Optional description: what is this room for?"
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
              <input
                value={roomTagsInput}
                onChange={(event) => setRoomTagsInput(event.target.value)}
                placeholder="Tags or genres: post-punk, 90s, shoegaze"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setRoomVisibility("private")}
                  className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${
                    roomVisibility === "private"
                      ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                      : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]"
                  }`}
                >
                  <Lock size={15} />
                  Invite-only
                </button>
                <button
                  type="button"
                  onClick={() => setRoomVisibility("public")}
                  className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${
                    roomVisibility === "public"
                      ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                      : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]"
                  }`}
                >
                  <Globe2 size={15} />
                  Public
                </button>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-foreground">
                <span className="inline-flex items-center gap-2">
                  <Pin size={15} className="text-cyan-300" />
                  Permanent room
                </span>
                <input
                  type="checkbox"
                  checked={roomPermanent}
                  onChange={(event) => setRoomPermanent(event.target.checked)}
                  className="h-4 w-4 accent-cyan-400"
                />
              </label>
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Open rooms</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your rooms are separate from public rooms you can discover and join.
                </p>
              </div>
              {roomsLoading ? <Loader2 size={18} className="animate-spin text-primary" /> : null}
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <Search size={15} className="text-muted-foreground" />
              <input
                value={roomSearch}
                onChange={(event) => setRoomSearch(event.target.value)}
                placeholder="Search public and permanent rooms by genre, tag, decade..."
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="mt-5 space-y-6">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Your rooms</h3>
                  <span className="text-xs text-muted-foreground">{memberRooms.length}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {memberRooms.map((listedRoom) => renderRoomCard(listedRoom, "member"))}
                  {!roomsLoading && memberRooms.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
                      No rooms where you are a member match this search.
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Public rooms to discover</h3>
                  <span className="text-xs text-muted-foreground">{publicRooms.length}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {publicRooms.map((listedRoom) => renderRoomCard(listedRoom, "public"))}
                  {!roomsLoading && publicRooms.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
                      No public rooms match this search yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Join from invite</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a full invite link or just the token.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={inviteInput}
              onChange={(event) => setInviteInput(event.target.value)}
              placeholder="https://…/jam/invite/abc123"
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none focus:border-cyan-400/40"
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
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
            >
              <Users size={15} />
              Join room
            </button>
          </div>
        </section>
      </div>
      {deleteRoomModal}
      </>
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
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {room.description || `${room.members.length} member${room.members.length !== 1 ? "s" : ""} in the room. Use invites to bring people in, then sync playback or shape the shared queue together.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {isConnected ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                  <Radio size={12} className="text-emerald-300" />
                  Connected to room
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                  {connectionProblem && !connectionProblem.includes("Retrying")
                    ? <Radio size={12} />
                    : <Loader2 size={12} className="animate-spin" />}
                  {connectionProblem || "Connecting to room..."}
                </div>
              )}
              {!roomIsActive ? (
                <div className="inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                  Room ended
                </div>
              ) : null}
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-muted-foreground">
                {room.visibility === "public" ? <Globe2 size={12} /> : <Lock size={12} />}
                {room.visibility === "public" ? "Public room" : "Invite-only"}
              </div>
              {room.is_permanent ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                  <Pin size={12} />
                  Permanent
                </div>
              ) : null}
              {(room.tags || []).map((tag) => (
                <div key={tag} className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-muted-foreground">
                  {tag}
                </div>
              ))}
              {roomCurrentTrack ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Now playing in room</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{roomCurrentTrack.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {roomCurrentTrack.artist}
                    {roomCurrentTrack.album ? ` · ${roomCurrentTrack.album}` : ""}
                  </div>
                </div>
              ) : null}
              {syncStatus !== "idle" ? (
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  syncStatus === "synced"
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                    : "border-amber-400/25 bg-amber-400/10 text-amber-200"
                }`}>
                  <Zap size={12} className={syncStatus === "synced" ? "text-emerald-400" : "text-amber-400"} />
                  {syncStatus === "synced" ? "Synced" : "Syncing..."}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-black/20 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
              <HeroActionButton
                label="Add current track"
                onClick={shareCurrentTrack}
                disabled={!roomIsActive || !isConnected}
                className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15 hover:text-cyan-100"
              >
                <Plus size={17} />
              </HeroActionButton>
              <HeroActionButton
                label="Play room queue"
                onClick={handlePlayRoomQueue}
                disabled={sharedQueue.length === 0}
              >
                <ListMusic size={17} />
              </HeroActionButton>
              {isHost ? (
                <HeroActionButton
                  label={syncStatus === "synced" ? "Resync playback" : "Sync playback"}
                  onClick={syncPlaybackState}
                  disabled={!roomIsActive || !isConnected}
                  className={
                    syncStatus === "synced"
                      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                      : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15"
                  }
                >
                  {isPlaying ? <Play size={17} /> : <Pause size={17} />}
                </HeroActionButton>
              ) : (
                <div
                  title={syncStatus === "synced" ? "Synced with host" : syncStatus === "drifting" ? "Catching up" : "Waiting for host"}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/[0.01] text-white/25"
                >
                  <Zap size={17} />
                </div>
              )}
            </div>

            {isHost ? (
              <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.025] p-1">
                <HeroActionButton
                  label={room.visibility === "public" ? "Make room invite-only" : "Make room public"}
                  onClick={() => void updateRoomSettings(
                    { visibility: room.visibility === "public" ? "private" : "public" },
                    "visibility",
                  )}
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "visibility"}
                >
                  {room.visibility === "public" ? <Lock size={16} /> : <Globe2 size={16} />}
                </HeroActionButton>
                <HeroActionButton
                  label={room.is_permanent ? "Unpin permanent room" : "Make room permanent"}
                  onClick={() => void updateRoomSettings({ is_permanent: !room.is_permanent }, "permanent")}
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "permanent"}
                >
                  <Pin size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label="Edit room profile"
                  onClick={openMetadataModal}
                  disabled={updatingRoomField !== null}
                  loading={updatingRoomField === "metadata"}
                >
                  <ListMusic size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label="Invite people"
                  onClick={handleCreateInvite}
                  disabled={!roomIsActive}
                  loading={creatingInvite}
                >
                  <Share2 size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label="End room"
                  onClick={handleEndRoom}
                  disabled={!roomIsActive}
                  loading={endingRoom}
                  className="border-red-500/15 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                >
                  <Power size={16} />
                </HeroActionButton>
                {isHost ? (
                  <HeroActionButton
                    label="Delete room"
                    onClick={() => requestDeleteRoom(room)}
                    disabled={deletingRoomId === room.id}
                    loading={deletingRoomId === room.id}
                    className="border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/15 hover:text-red-100"
                  >
                    <Trash2 size={16} />
                  </HeroActionButton>
                ) : null}
              </div>
            ) : null}
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
                <div className="flex min-w-0 items-center gap-3">
                  <AvatarBubble name={displayName(member)} avatar={member.avatar} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {displayName(member)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {member.username ? `@${member.username}` : "Profile"} · {member.role}
                    </div>
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

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <Search size={15} className="text-muted-foreground" />
              <input
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
                disabled={!canEditQueue}
                placeholder={canEditQueue ? "Search tracks to add to this room" : "Only hosts and collaborators can add tracks"}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              {queueSearchLoading ? <Loader2 size={15} className="animate-spin text-primary" /> : null}
            </div>
            {queueSearchResults.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                {queueSearchResults.map((track) => {
                  const playable = searchTrackToTrack(track);
                  return (
                    <button
                      key={playable.id || playable.path || `${track.artist}-${track.title}`}
                      type="button"
                      onClick={() => addSearchTrackToRoom(track)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05]"
                    >
                      {playable.albumCover ? (
                        <img src={playable.albumCover} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                          <ListMusic size={15} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{playable.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {playable.artist}
                          {playable.album ? ` · ${playable.album}` : ""}
                        </div>
                      </div>
                      <Plus size={15} className="text-cyan-300" />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {sharedQueue.map((track, index) => (
              <div
                key={`${track.id}-${index}`}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3"
              >
                <div className="w-6 text-center text-xs text-white/40">{index + 1}</div>
                {track.albumCover ? (
                  <img src={track.albumCover} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                    <ListMusic size={15} />
                  </div>
                )}
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
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Nothing in the shared queue yet. Play something and click <b>Add current track</b> above, or browse your library to find tracks to seed the room.
                </p>
                <Link
                  to="/search"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                >
                  <Search size={15} />
                  Browse library
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Recent room activity</h2>
          <div className="mt-4 space-y-3">
            {[...room.events].reverse().slice(0, 20).map((event) => {
              const actor = resolveJamActor(event, room.members, user);
              const payload = (event.payload_json || {}) as Record<string, unknown>;
              const track = payloadToTrack(payload.track as Record<string, unknown> | undefined);
              return (
                <div
                  key={event.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <AvatarBubble name={actor.name} avatar={actor.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-foreground">{eventActivityText(event, actor.name)}</div>
                        <div className="shrink-0 text-[11px] text-muted-foreground">
                          {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      {track ? (
                        <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/20 p-2">
                          {track.albumCover ? (
                            <img src={track.albumCover} alt="" className="h-9 w-9 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                              <ListMusic size={14} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-foreground">{track.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{track.artist}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {room.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No room events yet.</p>
            ) : null}
          </div>
        </section>
      </div>

      {deleteRoomModal}

      <AppModal open={metadataModalOpen} onClose={() => setMetadataModalOpen(false)} maxWidthClassName="sm:max-w-lg">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Room profile</h2>
            <p className="text-xs text-muted-foreground">Describe the vibe so public and permanent rooms are easier to discover.</p>
          </div>
          <ModalCloseButton onClick={() => setMetadataModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Description</span>
              <textarea
                value={metadataDescription}
                onChange={(event) => setMetadataDescription(event.target.value)}
                rows={4}
                placeholder="Post-punk, cold wave and angular guitars. Mostly 80s and 90s."
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Tags / genres</span>
              <input
                value={metadataTagsInput}
                onChange={(event) => setMetadataTagsInput(event.target.value)}
                placeholder="post-punk, 90s, gothic rock"
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetadataModalOpen(false)}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRoomMetadata()}
                disabled={updatingRoomField === "metadata"}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {updatingRoomField === "metadata" ? <Loader2 size={15} className="animate-spin" /> : <ListMusic size={15} />}
                Save profile
              </button>
            </div>
          </div>
        </ModalBody>
      </AppModal>

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
