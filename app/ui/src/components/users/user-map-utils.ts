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
