import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { api } from "@/lib/api";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { Shell } from "@/components/layout/Shell";
import { Loader2 } from "lucide-react";

const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Browse = lazy(() => import("@/pages/Browse").then(m => ({ default: m.Browse })));
const Artist = lazy(() => import("@/pages/Artist").then(m => ({ default: m.Artist })));
const Album = lazy(() => import("@/pages/Album").then(m => ({ default: m.Album })));
const Health = lazy(() => import("@/pages/Health").then(m => ({ default: m.Health })));
const Insights = lazy(() => import("@/pages/Insights").then(m => ({ default: m.Insights })));
const MissingAlbums = lazy(() => import("@/pages/MissingAlbums").then(m => ({ default: m.MissingAlbums })));
const Quality = lazy(() => import("@/pages/Quality").then(m => ({ default: m.Quality })));
const Tasks = lazy(() => import("@/pages/Tasks").then(m => ({ default: m.Tasks })));
const Playlists = lazy(() => import("@/pages/Playlists").then(m => ({ default: m.Playlists })));
const Stack = lazy(() => import("@/pages/Stack").then(m => ({ default: m.Stack })));
const Genres = lazy(() => import("@/pages/Genres").then(m => ({ default: m.Genres })));
const Timeline = lazy(() => import("@/pages/Timeline").then(m => ({ default: m.Timeline })));
const Login = lazy(() => import("@/pages/Login").then(m => ({ default: m.Login })));
const Users = lazy(() => import("@/pages/Users").then(m => ({ default: m.Users })));
const DownloadPage = lazy(() => import("@/pages/Download").then(m => ({ default: m.DownloadPage })));
const Settings = lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })));
const Discover = lazy(() => import("@/pages/Discover").then(m => ({ default: m.Discover })));
const Profile = lazy(() => import("@/pages/Profile").then(m => ({ default: m.Profile })));
const NewReleases = lazy(() => import("@/pages/NewReleases").then(m => ({ default: m.NewReleases })));
const Upcoming = lazy(() => import("@/pages/Upcoming").then(m => ({ default: m.Upcoming })));
const Setup = lazy(() => import("@/pages/Setup").then(m => ({ default: m.Setup })));
const Analysis = lazy(() => import("@/pages/Analysis").then(m => ({ default: m.Analysis })));
const SystemHealth = lazy(() => import("@/pages/SystemHealth").then(m => ({ default: m.SystemHealth })));
const Logs = lazy(() => import("@/pages/Logs").then(m => ({ default: m.Logs })));
const PlaylistEditor = lazy(() => import("@/pages/PlaylistEditor").then(m => ({ default: m.PlaylistEditor })));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-lg font-medium">Admin access required</p>
        <p className="text-sm text-muted-foreground">Your account ({user.email}) does not have admin privileges.</p>
        <button onClick={() => window.location.href = "/login"} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-white">
          Switch account
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function SetupGuard() {
  useEffect(() => {
    api<{ needs_setup: boolean }>("/api/setup/status")
      .then(d => {
        if (d.needs_setup && !window.location.pathname.startsWith("/setup")) {
          window.location.href = "/setup";
        }
      })
      .catch(() => {});
  }, []);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <TooltipProvider>
            <SetupGuard />
            <Suspense fallback={<PageSpinner />}>
              <Routes>
                <Route path="setup" element={<Setup />} />
                <Route path="login" element={<Login />} />
                <Route
                  element={
                    <ProtectedRoute>
                      <Shell />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Dashboard />} />
                  <Route path="browse" element={<Browse />} />
                  <Route path="artists/:artistId/:slug" element={<Artist />} />
                  <Route path="albums/:albumId/:slug" element={<Album />} />
                  <Route path="health" element={<Health />} />
                  <Route path="download" element={<DownloadPage />} />
                  <Route path="insights" element={<Insights />} />
                  <Route path="missing-albums" element={<MissingAlbums />} />
                  <Route path="quality" element={<Quality />} />
                  <Route path="analysis" element={<Analysis />} />
                  <Route path="system" element={<SystemHealth />} />
                  <Route path="logs" element={<Logs />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="playlists" element={<Playlists />} />
                  <Route path="playlists/:playlistId" element={<PlaylistEditor />} />
                  <Route path="stack" element={<Stack />} />
                  <Route path="genres" element={<Genres />} />
                  <Route path="genres/:slug" element={<Genres />} />
                  <Route path="timeline" element={<Timeline />} />
                  <Route path="users" element={<Users />} />
                  <Route path="discover" element={<Discover />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="new-releases" element={<NewReleases />} />
                  <Route path="upcoming" element={<Upcoming />} />
                </Route>
              </Routes>
            </Suspense>
          </TooltipProvider>
        </NotificationProvider>
          <Toaster theme="dark" position="bottom-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}
