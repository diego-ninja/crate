import React, { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LikedTracksProvider } from "@/contexts/LikedTracksContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlaylistComposerProvider } from "@/contexts/PlaylistComposerContext";
import { SavedAlbumsProvider } from "@/contexts/SavedAlbumsContext";
import { UserSyncProvider } from "@/contexts/UserSyncContext";
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
const Stats = React.lazy(() =>
  import("@/pages/Stats").then((m) => ({ default: m.Stats })),
);
const Shows = React.lazy(() =>
  import("@/pages/Shows").then((m) => ({ default: m.Shows })),
);
const SearchResults = React.lazy(() =>
  import("@/pages/SearchResults").then((m) => ({ default: m.SearchResults })),
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
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          element={
            <ProtectedRoute>
              <PlayerProvider>
                <LikedTracksProvider>
                  <UserSyncProvider>
                    <SavedAlbumsProvider>
                      <PlaylistComposerProvider>
                        <Shell />
                      </PlaylistComposerProvider>
                    </SavedAlbumsProvider>
                  </UserSyncProvider>
                </LikedTracksProvider>
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
                      path="artist/:name"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Artist />
                        </Suspense>
                      }
                    />
                    <Route
                      path="artist/:name/top-tracks"
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
                      path="album/:artist/:album"
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
                      path="curation/playlist/:id"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <CuratedPlaylist />
                        </Suspense>
                      }
                    />
                  </Route>
                </Routes>
    </AuthProvider>
    </ErrorBoundary>
  );
}
