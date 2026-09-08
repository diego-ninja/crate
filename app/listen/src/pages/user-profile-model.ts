import type { TFunction } from "i18next";

export interface RelationshipState {
  following: boolean;
  followed_by: boolean;
  is_friend: boolean;
}

export interface PublicPlaylist {
  id: number;
  name: string;
  description?: string | null;
  cover_data_url?: string | null;
  visibility: "public" | "private";
  is_collaborative: boolean;
  track_count: number;
  total_duration: number;
  updated_at: string;
}

export interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

export interface ProfileTopGenre {
  name: string;
  play_count: number;
  minutes_listened: number;
}

export interface ProfileStats {
  plays_30d: number;
  minutes_30d: number;
  contributions: number;
  public_playlists: number;
}

export interface ProfileBadge {
  key: string;
  label: string;
  tone: "cyan" | "gold" | "green" | "rose" | "neutral" | string;
}

export interface ProfileContribution {
  id: number;
  source: string;
  album_id: number | null;
  album_entity_uid: string | null;
  album_slug: string | null;
  artist_name: string;
  album_name: string;
  has_cover: boolean | null;
  imported_at: string | null;
}

export interface PublicProfile {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  joined_at: string;
  followers_count: number;
  following_count: number;
  friends_count: number;
  public_playlists: PublicPlaylist[];
  relationship_state: RelationshipState;
  affinity_score: number;
  affinity_band: "low" | "medium" | "high" | "very_high";
  affinity_reasons: string[];
  followers_preview: UserListItem[];
  following_preview: UserListItem[];
  top_genre: ProfileTopGenre | null;
  stats: ProfileStats;
  badges: ProfileBadge[];
  contributions_preview: ProfileContribution[];
}

export function formatJoinedDate(
  value: string | null | undefined,
  locale: string,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(date);
}

export function affinityTone(band?: string) {
  switch (band) {
    case "very_high":
      return "user-profile-affinity-very-high";
    case "high":
      return "user-profile-affinity-high";
    case "medium":
      return "user-profile-affinity-medium";
    default:
      return "user-profile-affinity-low";
  }
}

export function badgeTone(tone: string) {
  switch (tone) {
    case "gold":
      return "user-profile-badge-gold";
    case "green":
      return "user-profile-badge-green";
    case "rose":
      return "user-profile-badge-rose";
    case "cyan":
      return "user-profile-badge-cyan";
    default:
      return "user-profile-badge-neutral";
  }
}

export function formatMinutes(minutes: number, t: TFunction) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return t("userProfile.duration.zero");
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0
      ? t("userProfile.duration.hoursMinutes", { hours, minutes: rest })
      : t("userProfile.duration.hours", { count: hours });
  }
  return t("userProfile.duration.minutes", { count: Math.round(minutes) });
}

export function affinityBandLabel(
  band: PublicProfile["affinity_band"],
  t: TFunction,
) {
  switch (band) {
    case "very_high":
      return t("userProfile.affinityBand.veryHigh");
    case "high":
      return t("userProfile.affinityBand.high");
    case "medium":
      return t("userProfile.affinityBand.medium");
    default:
      return t("userProfile.affinityBand.low");
  }
}
