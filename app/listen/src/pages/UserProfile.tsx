import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Loader2, Music4, UserPlus, UserRoundCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { api } from "@/lib/api";
import { formatTotalDuration } from "@/lib/utils";

interface RelationshipState {
  following: boolean;
  followed_by: boolean;
  is_friend: boolean;
}

interface PublicPlaylist {
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

interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

interface PublicProfile {
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
}

function UserAvatar({
  name,
  avatar,
  userId,
  className = "h-20 w-20",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  className?: string;
}) {
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} onError={handleAvatarError} className={`${className} rounded-full object-cover`} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div className={`${className} rounded-full bg-cyan-400/15 text-cyan-300 flex items-center justify-center text-2xl font-semibold`}>
      {initial}
    </div>
  );
}

function formatJoinedDate(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function affinityTone(band?: string) {
  switch (band) {
    case "very_high":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
    case "high":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
    case "medium":
      return "border-amber-400/30 bg-amber-400/10 text-amber-300";
    default:
      return "border-white/10 bg-white/[0.03] text-white/70";
  }
}

export function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const { data, loading, refetch } = useApi<PublicProfile>(
    username ? `/api/users/${encodeURIComponent(username)}/page` : null,
  );
  const [busy, setBusy] = useState(false);

  const isOwnProfile = useMemo(() => {
    return Boolean(data && user?.id === data.id);
  }, [data, user?.id]);

  async function handleFollowToggle() {
    if (!data || isOwnProfile) return;
    setBusy(true);
    try {
      if (data.relationship_state.following) {
        await api(`/api/users/${data.id}/follow`, "DELETE");
        toast.success(`You unfollowed ${data.display_name || data.username || "this user"}`);
      } else {
        await api(`/api/users/${data.id}/follow`, "POST");
        toast.success(`You are now following ${data.display_name || data.username || "this user"}`);
      }
      refetch();
    } catch {
      toast.error("Failed to update follow status");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-foreground">Profile not found</p>
        <Link to="/people" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft size={14} />
          Back to people
        </Link>
      </div>
    );
  }

  const displayName = data.display_name || data.username || "Unknown user";
  const followers = data.followers_preview || [];
  const following = data.following_preview || [];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <UserAvatar name={displayName} avatar={data.avatar} userId={data.id} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-3xl font-bold text-foreground">{displayName}</h1>
                {data.relationship_state.is_friend && !isOwnProfile ? (
                  <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300">
                    Friends
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {data.username ? `@${data.username}` : "No username yet"} · Joined {formatJoinedDate(data.joined_at)}
              </div>
              {data.bio ? <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">{data.bio}</p> : null}
            </div>
          </div>

          {!isOwnProfile ? (
            <button
              type="button"
              onClick={handleFollowToggle}
              disabled={busy}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                data.relationship_state.following
                  ? "border border-white/15 bg-white/5 text-foreground hover:bg-white/10"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : data.relationship_state.following ? <UserRoundCheck size={15} /> : <UserPlus size={15} />}
              {data.relationship_state.following ? "Following" : "Follow"}
            </button>
          ) : (
            <Link
              to="/settings"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
            >
              Edit account
            </Link>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Followers</div>
            <Link to={data.username ? `/users/${data.username}/followers` : "/people"} className="mt-2 block text-2xl font-semibold text-foreground hover:text-cyan-300 transition-colors">
              {data.followers_count}
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Following</div>
            <Link to={data.username ? `/users/${data.username}/following` : "/people"} className="mt-2 block text-2xl font-semibold text-foreground hover:text-cyan-300 transition-colors">
              {data.following_count}
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Friends</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{data.friends_count}</div>
          </div>
          <div className={`rounded-2xl border p-4 ${affinityTone(data.affinity_band)}`}>
            <div className="text-xs uppercase tracking-wide opacity-75">Affinity</div>
            <div className="mt-2 text-2xl font-semibold">{data.affinity_score}%</div>
            <div className="mt-1 text-xs capitalize opacity-75">{data.affinity_band.replace("_", " ")}</div>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold text-foreground">Why you match</h2>
        </div>
        {isOwnProfile ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This is your public profile. When you visit someone else here, Crate will compare your listening and library overlap.
          </p>
        ) : data.affinity_reasons.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.affinity_reasons.map((reason) => (
              <span
                key={reason}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70"
              >
                {reason}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Not enough shared listening yet. As both profiles build up activity, this score will get more useful.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Music4 size={16} className="text-cyan-300" />
            <h2 className="text-lg font-semibold text-foreground">Public playlists</h2>
          </div>
          <div className="mt-4 space-y-3">
            {data.public_playlists.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                No public playlists yet.
              </div>
            ) : (
              data.public_playlists.map((playlist) => (
                <Link
                  key={playlist.id}
                  to={`/playlist/${playlist.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
                >
                  {playlist.cover_data_url ? (
                    <img
                      src={playlist.cover_data_url}
                      alt={playlist.name}
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-xl bg-white/5 flex items-center justify-center text-lg font-semibold text-white/40">
                      {playlist.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{playlist.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {playlist.track_count} tracks
                      {playlist.total_duration > 0 ? ` · ${formatTotalDuration(playlist.total_duration)}` : ""}
                      {playlist.is_collaborative ? " · Collaborative" : ""}
                    </div>
                    {playlist.description ? <div className="mt-1 truncate text-xs text-muted-foreground">{playlist.description}</div> : null}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Followers</h2>
              {data.username ? (
                <Link to={`/users/${data.username}/followers`} className="text-xs text-cyan-300 hover:underline">
                  See all
                </Link>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {(followers || []).slice(0, 6).map((item) => (
                <Link
                  key={`follower-${item.id}`}
                  to={item.username ? `/users/${item.username}` : "/people"}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-colors"
                >
                  <UserAvatar name={item.display_name || item.username || "User"} avatar={item.avatar} userId={item.id} className="h-10 w-10" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{item.display_name || item.username}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.username ? `@${item.username}` : "Profile"}</div>
                  </div>
                </Link>
              ))}
              {(!followers || followers.length === 0) ? (
                <p className="text-sm text-muted-foreground">No followers yet.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Following</h2>
              {data.username ? (
                <Link to={`/users/${data.username}/following`} className="text-xs text-cyan-300 hover:underline">
                  See all
                </Link>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {(following || []).slice(0, 6).map((item) => (
                <Link
                  key={`following-${item.id}`}
                  to={item.username ? `/users/${item.username}` : "/people"}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.05] transition-colors"
                >
                  <UserAvatar name={item.display_name || item.username || "User"} avatar={item.avatar} userId={item.id} className="h-10 w-10" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{item.display_name || item.username}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.username ? `@${item.username}` : "Profile"}</div>
                  </div>
                </Link>
              ))}
              {(!following || following.length === 0) ? (
                <p className="text-sm text-muted-foreground">Not following anyone yet.</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
