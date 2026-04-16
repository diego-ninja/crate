import React, { Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { connectCacheEvents } from "@/lib/cache";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { isNative } from "@/lib/capacitor";
import { getCurrentServer, SERVER_STORE_EVENT } from "@/lib/server-store";
import { ServerSetup } from "@/pages/ServerSetup";
import { ArtistFollowsProvider } from "@/contexts/ArtistFollowsContext";
import { LikedTracksProvider } from "@/contexts/LikedTracksContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlaylistComposerProvider } from "@/contexts/PlaylistComposerContext";
import { SavedAlbumsProvider } from "@/contexts/SavedAlbumsContext";
import { Shell } from "@/components/layout/Shell";
import { Home } from "@/pages/Home";
import { Explore } from "@/pages/Explore";
import { Library } from "@/pages/Library";
import { Settings } from "@/pages/Settings";
import { Upload } from "@/pages/Upload";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";

const Artist = React.lazy(() =>
  import("@/pages/Artist").then((m) => ({ default: m.Artist })),
);
const ArtistTopTracks = React.lazy(() =>
  import("@/pages/ArtistTopTracks").then((m) => ({ default: m.ArtistTopTracks })),
);
const Album = React.lazy(() =>
  import("@/pages/Album").then((m) => ({ default: m.Album })),
);
const Playlist = React.lazy(() =>
  import("@/pages/Playlist").then((m) => ({ default: m.Playlist })),
);
const CuratedPlaylist = React.lazy(() =>
  import("@/pages/CuratedPlaylist").then((m) => ({ default: m.CuratedPlaylist })),
);
const HomePlaylist = React.lazy(() =>
  import("@/pages/HomePlaylist").then((m) => ({ default: m.HomePlaylist })),
);
const HomeSection = React.lazy(() =>
  import("@/pages/HomeSection").then((m) => ({ default: m.HomeSection })),
);
const Stats = React.lazy(() =>
  import("@/pages/Stats").then((m) => ({ default: m.Stats })),
);
const Shows = React.lazy(() =>
  import("@/pages/Shows").then((m) => ({ default: m.Shows })),
);
const SearchResults = React.lazy(() =>
  import("@/pages/SearchResults").then((m) => ({ default: m.SearchResults })),
);
const People = React.lazy(() =>
  import("@/pages/People").then((m) => ({ default: m.People })),
);
const UserProfile = React.lazy(() =>
  import("@/pages/UserProfile").then((m) => ({ default: m.UserProfile })),
);
const UserConnections = React.lazy(() =>
  import("@/pages/UserConnections").then((m) => ({ default: m.UserConnections })),
);
const JamSession = React.lazy(() =>
  import("@/pages/JamSession").then((m) => ({ default: m.JamSession })),
);
const JamInvite = React.lazy(() =>
  import("@/pages/JamInvite").then((m) => ({ default: m.JamInvite })),
);
const PlaylistInvite = React.lazy(() =>
  import("@/pages/PlaylistInvite").then((m) => ({ default: m.PlaylistInvite })),
);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app-surface text-white">
          <p className="text-lg font-medium">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-md text-center">{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-white">
            Go home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Connect to cache invalidation SSE when authenticated
  useEffect(() => {
    if (!user) return;
    return connectCacheEvents();
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

/**
 * Capacitor-only gate: if the user hasn't configured any Crate server
 * yet, force them through /server-setup before anything else renders.
 * Subscribes to store events so adding a server in ServerSetup flushes
 * the redirect immediately.
 */
function ServerGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [hasServer, setHasServer] = useState(() => !isNative || Boolean(getCurrentServer()));

  useEffect(() => {
    if (!isNative) return;
    const sync = () => setHasServer(Boolean(getCurrentServer()));
    window.addEventListener(SERVER_STORE_EVENT, sync);
    return () => window.removeEventListener(SERVER_STORE_EVENT, sync);
  }, []);

  if (!isNative) return <>{children}</>;
  if (hasServer) return <>{children}</>;
  if (location.pathname === "/server-setup") return <>{children}</>;
  return <Navigate to="/server-setup" replace />;
}

export function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <ServerGate>
      <Routes>
        <Route path="/server-setup" element={<ServerSetup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          element={
            <ProtectedRoute>
              <PlayerProvider>
                <ArtistFollowsProvider>
                  <LikedTracksProvider>
                    <SavedAlbumsProvider>
                      <PlaylistComposerProvider>
                        <Shell />
                      </PlaylistComposerProvider>
                    </SavedAlbumsProvider>
                  </LikedTracksProvider>
                </ArtistFollowsProvider>
              </PlayerProvider>
            </ProtectedRoute>
          }
        >
                    <Route index element={<Home />} />
                    <Route path="explore" element={<Explore />} />
                    <Route path="search" element={<Suspense fallback={<Spinner />}><SearchResults /></Suspense>} />
                    <Route path="library" element={<Library />} />
                    <Route
                      path="stats"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Stats />
                        </Suspense>
                      }
                    />
                    <Route path="upload" element={<Upload />} />
                    <Route path="settings" element={<Settings />} />
                    <Route
                      path="people"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <People />
                        </Suspense>
                      }
                    />
                    <Route
                      path="users/:username"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <UserProfile />
                        </Suspense>
                      }
                    />
                    <Route
                      path="users/:username/followers"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <UserConnections />
                        </Suspense>
                      }
                    />
                    <Route
                      path="users/:username/following"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <UserConnections />
                        </Suspense>
                      }
                    />
                    <Route
                      path="jam"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <JamSession />
                        </Suspense>
                      }
                    />
                    <Route
                      path="jam/rooms/:roomId"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <JamSession />
                        </Suspense>
                      }
                    />
                    <Route
                      path="jam/invite/:token"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <JamInvite />
                        </Suspense>
                      }
                    />
                    <Route
                      path="playlist/invite/:token"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <PlaylistInvite />
                        </Suspense>
                      }
                    />
                    <Route path="shows" element={<Navigate to="/upcoming" replace />} />
                    <Route
                      path="upcoming"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Shows />
                        </Suspense>
                      }
                    />
                    <Route
                      path="artists/:artistId/:slug"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Artist />
                        </Suspense>
                      }
                    />
                    <Route
                      path="artists/:artistId/:slug/top-tracks"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <ArtistTopTracks />
                        </Suspense>
                      }
                    />
                    <Route
                      path="albums/:albumId/:slug"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Album />
                        </Suspense>
                      }
                    />
                    <Route
                      path="playlist/:id"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Playlist />
                        </Suspense>
                      }
                    />
                    <Route
                      path="home/playlist/:playlistId"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <HomePlaylist />
                        </Suspense>
                      }
                    />
                    <Route
                      path="home/section/:sectionId"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <HomeSection />
                        </Suspense>
                      }
                    />
                    <Route
                      path="curation/playlist/:id"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <CuratedPlaylist />
                        </Suspense>
                      }
                    />
                  </Route>
                </Routes>
      </ServerGate>
    </AuthProvider>
    </ErrorBoundary>
  );
}
