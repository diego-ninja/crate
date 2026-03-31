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
import { Shows } from "@/pages/Shows";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";

const Artist = React.lazy(() =>
  import("@/pages/Artist").then((m) => ({ default: m.Artist })),
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
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
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
    <AuthProvider>
      <PlayerProvider>
        <LikedTracksProvider>
          <UserSyncProvider>
            <SavedAlbumsProvider>
              <PlaylistComposerProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route
                    element={
                      <ProtectedRoute>
                        <Shell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Home />} />
                    <Route path="explore" element={<Explore />} />
                    <Route path="library" element={<Library />} />
                    <Route path="shows" element={<Shows />} />
                    <Route
                      path="artist/:name"
                      element={
                        <Suspense fallback={<Spinner />}>
                          <Artist />
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
              </PlaylistComposerProvider>
            </SavedAlbumsProvider>
          </UserSyncProvider>
        </LikedTracksProvider>
      </PlayerProvider>
    </AuthProvider>
  );
}
