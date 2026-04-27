import React, { Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { connectCacheEvents } from "@/lib/cache";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { isNative } from "@/lib/capacitor";
import { getCurrentServer, SERVER_STORE_EVENT } from "@/lib/server-store";
import { ArtistFollowsProvider } from "@/contexts/ArtistFollowsContext";
import { LikedTracksProvider } from "@/contexts/LikedTracksContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlaylistComposerProvider } from "@/contexts/PlaylistComposerContext";
import { SavedAlbumsProvider } from "@/contexts/SavedAlbumsContext";
import { OfflineProvider } from "@/contexts/OfflineContext";
import { Shell } from "@/components/layout/Shell";
import { Home } from "@/pages/Home";

const ServerSetup = React.lazy(() =>
  import("@/pages/ServerSetup").then((m) => ({ default: m.ServerSetup })),
);
const AuthCallback = React.lazy(() =>
  import("@/pages/AuthCallback").then((m) => ({ default: m.AuthCallback })),
);
const Login = React.lazy(() =>
  import("@/pages/Login").then((m) => ({ default: m.Login })),
);
const Register = React.lazy(() =>
  import("@/pages/Register").then((m) => ({ default: m.Register })),
);
const Explore = React.lazy(() =>
  import("@/pages/Explore").then((m) => ({ default: m.Explore })),
);
const Library = React.lazy(() =>
  import("@/pages/Library").then((m) => ({ default: m.Library })),
);
const Settings = React.lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const Upload = React.lazy(() =>
  import("@/pages/Upload").then((m) => ({ default: m.Upload })),
);
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
const PathsPage = React.lazy(() =>
  import("@/pages/Paths").then((m) => ({ default: m.Paths })),
);
const PathDetailPage = React.lazy(() =>
  import("@/pages/PathDetail").then((m) => ({ default: m.PathDetail })),
);
const RadioPage = React.lazy(() =>
  import("@/pages/Radio").then((m) => ({ default: m.RadioPage })),
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

function DeferredRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
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
        <Route path="/server-setup" element={<DeferredRoute><ServerSetup /></DeferredRoute>} />
        <Route path="/auth/callback" element={<DeferredRoute><AuthCallback /></DeferredRoute>} />
        <Route path="/login" element={<DeferredRoute><Login /></DeferredRoute>} />
        <Route path="/register" element={<DeferredRoute><Register /></DeferredRoute>} />
        <Route
          element={
            <ProtectedRoute>
              <PlayerProvider>
                <ArtistFollowsProvider>
                  <LikedTracksProvider>
                    <OfflineProvider>
                      <SavedAlbumsProvider>
                        <PlaylistComposerProvider>
                          <Shell />
                        </PlaylistComposerProvider>
                      </SavedAlbumsProvider>
                    </OfflineProvider>
                  </LikedTracksProvider>
                </ArtistFollowsProvider>
              </PlayerProvider>
            </ProtectedRoute>
          }
        >
                    <Route index element={<Home />} />
                    <Route path="explore" element={<DeferredRoute><Explore /></DeferredRoute>} />
                    <Route path="search" element={<DeferredRoute><SearchResults /></DeferredRoute>} />
                    <Route path="library" element={<DeferredRoute><Library /></DeferredRoute>} />
                    <Route
                      path="stats"
                      element={
                        <DeferredRoute>
                          <Stats />
                        </DeferredRoute>
                      }
                    />
                    <Route path="upload" element={<DeferredRoute><Upload /></DeferredRoute>} />
                    <Route path="settings" element={<DeferredRoute><Settings /></DeferredRoute>} />
                    <Route
                      path="people"
                      element={
                        <DeferredRoute>
                          <People />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="users/:username"
                      element={
                        <DeferredRoute>
                          <UserProfile />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="users/:username/followers"
                      element={
                        <DeferredRoute>
                          <UserConnections />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="users/:username/following"
                      element={
                        <DeferredRoute>
                          <UserConnections />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="jam"
                      element={
                        <DeferredRoute>
                          <JamSession />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="jam/rooms/:roomId"
                      element={
                        <DeferredRoute>
                          <JamSession />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="jam/invite/:token"
                      element={
                        <DeferredRoute>
                          <JamInvite />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="playlist/invite/:token"
                      element={
                        <DeferredRoute>
                          <PlaylistInvite />
                        </DeferredRoute>
                      }
                    />
                    <Route path="shows" element={<Navigate to="/upcoming" replace />} />
                    <Route
                      path="upcoming"
                      element={
                        <DeferredRoute>
                          <Shows />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="paths"
                      element={
                        <DeferredRoute>
                          <PathsPage />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="paths/:id"
                      element={
                        <DeferredRoute>
                          <PathDetailPage />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="radio"
                      element={
                        <DeferredRoute>
                          <RadioPage />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="artists/:artistId/:slug"
                      element={
                        <DeferredRoute>
                          <Artist />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="artists/:artistId/:slug/top-tracks"
                      element={
                        <DeferredRoute>
                          <ArtistTopTracks />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="albums/:albumId/:slug"
                      element={
                        <DeferredRoute>
                          <Album />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="playlist/:id"
                      element={
                        <DeferredRoute>
                          <Playlist />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="home/playlist/:playlistId"
                      element={
                        <DeferredRoute>
                          <HomePlaylist />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="home/section/:sectionId"
                      element={
                        <DeferredRoute>
                          <HomeSection />
                        </DeferredRoute>
                      }
                    />
                    <Route
                      path="curation/playlist/:id"
                      element={
                        <DeferredRoute>
                          <CuratedPlaylist />
                        </DeferredRoute>
                      }
                    />
                  </Route>
                </Routes>
      </ServerGate>
    </AuthProvider>
    </ErrorBoundary>
  );
}
