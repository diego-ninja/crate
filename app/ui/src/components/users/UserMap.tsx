import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  Headphones,
  MapPin,
  Users as UsersIcon,
  X,
} from "lucide-react";

import { useApi } from "@/hooks/use-api";

export interface MapTrack {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

export interface MapUser {
  id: number;
  name: string;
  email: string;
  username?: string | null;
  avatar: string | null;
  city: string | null;
  country: string | null;
  country_code?: string | null;
  latitude: number;
  longitude: number;
  role?: string | null;
  status?: string | null;
  created_at?: string | null;
  last_login?: string | null;
  last_seen_at?: string | null;
  last_activity_at?: string | null;
  activity_status?: "active" | "inactive" | "never_active" | string;
  active_sessions?: number;
  active_devices?: number;
  online: boolean;
  listening_now?: boolean;
  last_played_at?: string | null;
  current_track?: MapTrack | null;
  now_playing: MapTrack | null;
}

export interface MapUserGroup {
  key: string;
  latitude: number;
  longitude: number;
  users: MapUser[];
}

export function groupMapUsers(users: MapUser[]): MapUserGroup[] {
  const grouped = new Map<string, MapUser[]>();

  for (const user of users) {
    if (
      !Number.isFinite(user.latitude) ||
      !Number.isFinite(user.longitude) ||
      user.latitude < -90 ||
      user.latitude > 90 ||
      user.longitude < -180 ||
      user.longitude > 180
    ) {
      continue;
    }

    const key = `${user.latitude.toFixed(5)}:${user.longitude.toFixed(5)}`;
    const group = grouped.get(key);
    if (group) group.push(user);
    else grouped.set(key, [user]);
  }

  return Array.from(grouped.entries())
    .map(([key, groupUsers]) => ({
      key,
      latitude: groupUsers[0]!.latitude,
      longitude: groupUsers[0]!.longitude,
      users: [...groupUsers].sort((left, right) => left.id - right.id),
    }))
    .sort(
      (left, right) =>
        left.latitude - right.latitude || left.longitude - right.longitude,
    );
}

function markerIcon(group: MapUserGroup): L.DivIcon {
  const primaryUser = group.users[0]!;
  const color = primaryUser.now_playing
    ? "#06b6d4"
    : primaryUser.online
      ? "#22c55e"
      : "#6b7280";
  const label = group.users.length > 1 ? String(group.users.length) : "";

  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:999px;background:${color};border:3px solid #0a0a14;box-shadow:0 0 12px ${color}66;color:#0a0a14;font-size:11px;font-weight:800">${label}</div>`,
  });
}

function locationLabel(user: MapUser) {
  const location = [user.city, user.country].filter(Boolean).join(", ");
  return (
    location || `${user.latitude.toFixed(3)}, ${user.longitude.toFixed(3)}`
  );
}

function activityLabel(user: MapUser) {
  if (user.activity_status === "inactive") return "Inactive";
  if (user.activity_status === "never_active") return "No activity yet";
  return "Active recently";
}

function activityClass(user: MapUser) {
  if (user.activity_status === "inactive") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  }
  if (user.activity_status === "never_active") {
    return "border-white/10 bg-white/5 text-white/50";
  }
  return "border-green-400/25 bg-green-400/10 text-green-200";
}

function statusLabel(status?: string | null) {
  const normalized = (status || "active").trim().toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

function FitBounds({ groups }: { groups: MapUserGroup[] }) {
  const map = useMap();
  const fittedSignature = useRef<string | null>(null);
  const signature = groups.map((group) => group.key).join("|");

  useEffect(() => {
    if (!groups.length || fittedSignature.current === signature) return;
    fittedSignature.current = signature;
    if (groups.length === 1) {
      map.setView([groups[0]!.latitude, groups[0]!.longitude], 6);
      return;
    }
    const bounds = L.latLngBounds(
      groups.map(
        (group) => [group.latitude, group.longitude] as [number, number],
      ),
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }, [groups, map, signature]);

  return null;
}

function UserDetails({
  user,
  onInspectUser,
}: {
  user: MapUser;
  onInspectUser?: (user: MapUser) => void;
}) {
  const track = user.current_track || user.now_playing;

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-start gap-3">
        {user.avatar ? (
          <img
            src={user.avatar}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-md border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/8 text-sm font-semibold text-white/65">
            {(user.name || user.email || "?")[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">
            {user.name || user.email}
          </div>
          <div className="truncate text-xs text-white/50">{user.email}</div>
          <div className="mt-1 truncate text-xs text-white/35">
            {locationLabel(user)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${activityClass(
            user,
          )}`}
        >
          <Activity size={10} />
          {activityLabel(user)}
        </span>
        <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/55">
          {statusLabel(user.status)}
        </span>
        {user.online ? (
          <span className="inline-flex items-center rounded-md border border-green-400/25 bg-green-400/10 px-1.5 py-0.5 text-green-200">
            Online
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-white/8 bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">
            Last activity
          </div>
          <div className="mt-1 text-white/75">
            {formatTimestamp(user.last_activity_at)}
          </div>
        </div>
        <div className="rounded-md border border-white/8 bg-black/15 p-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">
            Footprint
          </div>
          <div className="mt-1 text-white/75">
            {user.active_devices ?? 0} device
            {(user.active_devices ?? 0) === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {track ? (
        <div className="rounded-md border border-cyan-400/15 bg-cyan-400/8 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/60">
            <Headphones size={10} />
            {user.listening_now ? "Currently playing" : "Latest track"}
          </div>
          <div className="truncate text-white/80">
            {track.title || "Unknown track"}
          </div>
          <div className="truncate text-white/45">
            {[track.artist, track.album].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ) : null}

      {onInspectUser ? (
        <button
          type="button"
          className="w-full rounded-md border border-white/12 bg-white/6 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={() => onInspectUser(user)}
        >
          Inspect user
        </button>
      ) : null}
    </div>
  );
}

export function UserMap({
  onInspectUser,
}: {
  onInspectUser?: (user: MapUser) => void;
}) {
  const { data, loading } = useApi<{ users: MapUser[] }>(
    "/api/admin/users/map",
  );
  const users = data?.users ?? [];
  const groups = useMemo(() => groupMapUsers(users), [users]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey);
  const selectedUser = selectedGroup?.users.find(
    (user) => user.id === selectedUserId,
  );

  function selectGroup(group: MapUserGroup) {
    setSelectedGroupKey(group.key);
    setSelectedUserId(group.users[0]?.id ?? null);
  }

  if (loading && !data) {
    return (
      <div className="h-[390px] animate-pulse rounded-md border border-white/8 bg-white/[0.02]" />
    );
  }

  if (!groups.length) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-md border border-white/8 bg-white/[0.02] text-sm text-white/30">
        <MapPin size={16} className="mr-2" /> No users with location data
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-white/8 bg-panel-surface shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MapPin size={16} className="text-primary" />
            Users by location
          </div>
          <div className="mt-1 text-xs text-white/40">
            {users.length} users · {groups.length} locations
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-white/45">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-400" /> Online
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> Listening
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-gray-500" /> Offline
          </span>
        </div>
      </div>

      <div className="user-map-container relative overflow-hidden">
        <MapContainer
          center={[groups[0]?.latitude ?? 40, groups[0]?.longitude ?? -3]}
          zoom={4}
          style={{ height: 340, width: "100%" }}
          zoomControl
          attributionControl
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <FitBounds groups={groups} />
          {groups.map((group) => (
            <Marker
              key={group.key}
              position={[group.latitude, group.longitude]}
              icon={markerIcon(group)}
              title={`${group.users.length} users at ${locationLabel(
                group.users[0]!,
              )}`}
              eventHandlers={{ click: () => selectGroup(group) }}
            />
          ))}
        </MapContainer>

        {selectedGroup && selectedUser ? (
          <div
            role="dialog"
            aria-label="User map details"
            className="absolute right-3 top-3 z-[1000] max-h-[calc(100%-24px)] w-[min(360px,calc(100%-24px))] overflow-y-auto rounded-md border border-white/12 bg-[#11111f]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <UsersIcon size={15} className="text-primary" />
                  {selectedGroup.users.length} user
                  {selectedGroup.users.length === 1 ? "" : "s"} at this location
                </div>
                <div className="mt-1 text-xs text-white/40">
                  {locationLabel(selectedUser)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close user map details"
                className="rounded-md p-1 text-white/45 transition hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                onClick={() => setSelectedGroupKey(null)}
              >
                <X size={16} />
              </button>
            </div>

            {selectedGroup.users.length > 1 ? (
              <div className="mt-3 space-y-1.5">
                {selectedGroup.users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                      user.id === selectedUser.id
                        ? "border-primary/35 bg-primary/10 text-white"
                        : "border-white/8 bg-black/15 text-white/65 hover:bg-white/6"
                    }`}
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    <span className="min-w-0 truncate">
                      <span className="block truncate font-medium">
                        {user.name}
                      </span>
                      <span className="block truncate text-[10px] text-white/40">
                        {user.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-white/45">
                      {user.online ? "Online" : "Offline"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3">
              <UserDetails user={selectedUser} onInspectUser={onInspectUser} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
