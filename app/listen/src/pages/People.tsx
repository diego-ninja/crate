import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Loader2, Search, UserRoundPlus, Users } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

interface SocialSummary {
  followers_count: number;
  following_count: number;
  friends_count: number;
  profile: {
    id: number;
    username: string | null;
    display_name: string | null;
    avatar: string | null;
    bio: string | null;
  };
}

interface UserSearchResult {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  joined_at: string;
}

function UserAvatar({
  name,
  avatar,
  className = "h-11 w-11",
}: {
  name: string;
  avatar?: string | null;
  className?: string;
}) {
  if (avatar) {
    return <img src={avatar} alt={name} className={`${className} rounded-full object-cover`} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div className={`${className} rounded-full bg-cyan-400/15 text-cyan-300 flex items-center justify-center font-semibold`}>
      {initial}
    </div>
  );
}

export function People() {
  const { user } = useAuth();
  const { data, loading } = useApi<SocialSummary>("/api/me/social");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    api<UserSearchResult[]>(`/api/users/search?q=${encodeURIComponent(trimmed)}&limit=12`, "GET", undefined, {
      signal: controller.signal,
    })
      .then((items) => setResults(items || []))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      });
    return () => controller.abort();
  }, [query]);

  const ownProfileHref = useMemo(() => {
    if (!user?.username) return "/settings";
    return `/users/${user.username}`;
  }, [user?.username]);
  const ownFollowersHref = user?.username ? `/users/${user.username}/followers` : "/people";
  const ownFollowingHref = user?.username ? `/users/${user.username}/following` : "/people";

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">People</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Find other listeners, compare taste, and jump into shared sessions.
            </p>
          </div>
          <Link
            to="/jam"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
          >
            <Users size={16} />
            Jam sessions
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Link
            to={ownProfileHref}
            className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4 hover:bg-cyan-400/10 transition-colors"
          >
            <div className="text-xs uppercase tracking-wide text-cyan-300/70">Your profile</div>
            <div className="mt-2 text-lg font-semibold text-foreground">
              {data?.profile.display_name || user?.name || user?.email || "You"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {data?.profile.username ? `@${data.profile.username}` : "Set a username from settings/admin"}
            </div>
          </Link>
          <Link to={ownFollowersHref} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors">
            <div className="text-xs uppercase tracking-wide text-white/45">Followers</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{data?.followers_count ?? "—"}</div>
          </Link>
          <Link to={ownFollowingHref} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors">
            <div className="text-xs uppercase tracking-wide text-white/45">Following</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{data?.following_count ?? "—"}</div>
          </Link>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-wide text-white/45">Friends</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{data?.friends_count ?? "—"}</div>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <Search size={16} className="text-white/45" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by username or display name"
            className="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-white/30"
          />
        </div>

        <div className="mt-4 space-y-3">
          {query.trim() && searching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" />
              Searching people…
            </div>
          ) : null}

          {!query.trim() ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
              Search by username to open public profiles and compare affinity.
            </div>
          ) : null}

          {query.trim() && !searching && results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
              No users matched “{query.trim()}”.
            </div>
          ) : null}

          {results.map((item) => {
            const label = item.display_name || item.username || "Unknown user";
            return (
              <Link
                key={item.id}
                to={item.username ? `/users/${item.username}` : "/people"}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
              >
                <UserAvatar name={label} avatar={item.avatar} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.username ? `@${item.username}` : "No username yet"}
                  </div>
                  {item.bio ? <div className="mt-1 truncate text-xs text-white/55">{item.bio}</div> : null}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65">
                  <UserRoundPlus size={13} />
                  View profile
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : null}
    </div>
  );
}
