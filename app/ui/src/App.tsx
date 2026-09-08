import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { api } from "@/lib/api";
import { Toaster } from "sonner";
import { TooltipProvider } from "@crate/ui/shadcn/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LLMStatusProvider } from "@/hooks/use-llm";
import { OpsSnapshotProvider } from "@/contexts/OpsSnapshotContext";
import {
  CapabilityRoute,
  ProtectedRoute,
} from "@/components/auth/ProtectedRoute";
import { Shell } from "@/components/layout/Shell";

const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Browse = lazy(() =>
  import("@/pages/Browse").then((m) => ({ default: m.Browse })),
);
const Artist = lazy(() =>
  import("@/pages/Artist").then((m) => ({ default: m.Artist })),
);
const Album = lazy(() =>
  import("@/pages/Album").then((m) => ({ default: m.Album })),
);
const Health = lazy(() =>
  import("@/pages/Health").then((m) => ({ default: m.Health })),
);
const Insights = lazy(() =>
  import("@/pages/Insights").then((m) => ({ default: m.Insights })),
);
const Tasks = lazy(() =>
  import("@/pages/Tasks").then((m) => ({ default: m.Tasks })),
);
const Trash = lazy(() =>
  import("@/pages/Trash").then((m) => ({ default: m.Trash })),
);
const Contributions = lazy(() =>
  import("@/pages/Contributions").then((m) => ({ default: m.Contributions })),
);
const Playlists = lazy(() =>
  import("@/pages/Playlists").then((m) => ({ default: m.Playlists })),
);
const Stack = lazy(() =>
  import("@/pages/Stack").then((m) => ({ default: m.Stack })),
);
const Genres = lazy(() =>
  import("@/pages/Genres").then((m) => ({ default: m.Genres })),
);
const Timeline = lazy(() =>
  import("@/pages/Timeline").then((m) => ({ default: m.Timeline })),
);
const Login = lazy(() =>
  import("@/pages/Login").then((m) => ({ default: m.Login })),
);
const Users = lazy(() =>
  import("@/pages/Users").then((m) => ({ default: m.Users })),
);
const Roles = lazy(() =>
  import("@/pages/Roles").then((m) => ({ default: m.Roles })),
);
const DownloadPage = lazy(() =>
  import("@/pages/Download").then((m) => ({ default: m.DownloadPage })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const I18nReview = lazy(() =>
  import("@/pages/I18nReview").then((m) => ({ default: m.I18nReview })),
);
const Discover = lazy(() =>
  import("@/pages/Discover").then((m) => ({ default: m.Discover })),
);
const NewReleases = lazy(() =>
  import("@/pages/NewReleases").then((m) => ({ default: m.NewReleases })),
);
const Upcoming = lazy(() =>
  import("@/pages/Upcoming").then((m) => ({ default: m.Upcoming })),
);
const Bandcamp = lazy(() =>
  import("@/pages/Bandcamp").then((m) => ({ default: m.Bandcamp })),
);
const Setup = lazy(() =>
  import("@/pages/Setup").then((m) => ({ default: m.Setup })),
);
const Analysis = lazy(() =>
  import("@/pages/Analysis").then((m) => ({ default: m.Analysis })),
);
const SystemHealth = lazy(() =>
  import("@/pages/SystemHealth").then((m) => ({ default: m.SystemHealth })),
);
const Logs = lazy(() =>
  import("@/pages/Logs").then((m) => ({ default: m.Logs })),
);
const PlaylistEditor = lazy(() =>
  import("@/pages/PlaylistEditor").then((m) => ({ default: m.PlaylistEditor })),
);
const Federation = lazy(() =>
  import("@/pages/Federation").then((m) => ({ default: m.Federation })),
);
const GlobalCatalog = lazy(() =>
  import("@/pages/GlobalCatalog").then((m) => ({
    default: m.GlobalCatalog,
  })),
);

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-md border-2 border-primary border-t-transparent" />
    </div>
  );
}

function SetupGuard() {
  useEffect(() => {
    api<{ needs_setup: boolean }>("/api/setup/status")
      .then((d) => {
        if (d.needs_setup && !window.location.pathname.startsWith("/setup")) {
          window.location.href = "/setup";
        }
      })
      .catch(() => {});
  }, []);
  return null;
}

function ProfileRedirect() {
  const { user, loading, hasCapability } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasCapability("users.view")) return <Navigate to="/browse" replace />;
  return <Navigate to={`/users?inspect=${user.id}`} replace />;
}

function AdminIndex() {
  const { hasCapability } = useAuth();
  if (hasCapability("admin.access")) return <Dashboard />;
  if (hasCapability("ops.tasks.manage"))
    return <Navigate to="/tasks" replace />;
  if (hasCapability("ops.runtime.manage"))
    return <Navigate to="/stack" replace />;
  if (hasCapability("ops.logs.view")) return <Navigate to="/logs" replace />;
  if (hasCapability("ops.health.view"))
    return <Navigate to="/system" replace />;
  if (hasCapability("library.view")) return <Navigate to="/browse" replace />;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold text-foreground">
        No console landing page available
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        Your role can access the console, but this surface is not enabled yet.
      </p>
    </div>
  );
}

function RequireCapabilities({
  anyOf,
  children,
}: {
  anyOf: readonly string[];
  children: React.ReactNode;
}) {
  return <CapabilityRoute anyOf={anyOf}>{children}</CapabilityRoute>;
}

const LIBRARY_VIEW = ["library.view"] as const;
const LIBRARY_REPAIR_RUN = ["library.repair.run"] as const;
const LIBRARY_TRACK_REMOVE = ["library.track.remove"] as const;
const OPS_HEALTH_VIEW = ["ops.health.view"] as const;
const OPS_LOGS_VIEW = ["ops.logs.view"] as const;
const OPS_TASKS_MANAGE = ["ops.tasks.manage"] as const;
const OPS_RUNTIME_MANAGE = ["ops.runtime.manage"] as const;
const SETTINGS_MANAGE = ["settings.manage"] as const;
const LIBRARY_ANALYSIS_MANAGE = ["library.analysis.manage"] as const;
const USERS_VIEW = ["users.view"] as const;
const ROLES_VIEW = ["roles.view"] as const;
const ADMIN_ACCESS = ["admin.access"] as const;
const RELEASE_CURATION = [
  "curation.releases.write",
  "library.tidal.manage",
] as const;
const ACQUISITION_MANAGE = [
  "library.import.manage",
  "library.tidal.manage",
] as const;
const CONTRIBUTION_REVIEW = ["library.import.manage"] as const;
const BANDCAMP_MANAGE = ["library.bandcamp.manage"] as const;
const UPCOMING_CURATION = [
  "curation.shows.write",
  "curation.releases.write",
  "library.tidal.manage",
] as const;
const SYSTEM_PLAYLISTS_WRITE = ["curation.playlists.write"] as const;
const FEDERATION_NODES_VIEW = ["federation.nodes.view"] as const;
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <SetupGuard />
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route path="setup" element={<Setup />} />
              <Route path="login" element={<Login />} />
              <Route
                element={
                  <ProtectedRoute>
                    <LLMStatusProvider>
                      <OpsSnapshotProvider>
                        <Shell />
                      </OpsSnapshotProvider>
                    </LLMStatusProvider>
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminIndex />} />
                <Route
                  path="browse"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Browse />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="artists/:artistSlug/:albumSlug"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Album />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="artists/:artistSlug"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Artist />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="artists/:artistId/:slug"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Artist />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="albums/:albumId/:slug"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Album />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="health"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_REPAIR_RUN}>
                      <Health />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="trash"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_TRACK_REMOVE}>
                      <Trash />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="download"
                  element={
                    <RequireCapabilities anyOf={ACQUISITION_MANAGE}>
                      <DownloadPage />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="contributions"
                  element={
                    <RequireCapabilities anyOf={CONTRIBUTION_REVIEW}>
                      <Contributions />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="insights"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Insights />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="analysis"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_ANALYSIS_MANAGE}>
                      <Analysis />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="system"
                  element={
                    <RequireCapabilities anyOf={OPS_HEALTH_VIEW}>
                      <SystemHealth />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="logs"
                  element={
                    <RequireCapabilities anyOf={OPS_LOGS_VIEW}>
                      <Logs />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="tasks"
                  element={
                    <RequireCapabilities anyOf={OPS_TASKS_MANAGE}>
                      <Tasks />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="playlists"
                  element={
                    <RequireCapabilities anyOf={SYSTEM_PLAYLISTS_WRITE}>
                      <Playlists />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="playlists/:playlistId"
                  element={
                    <RequireCapabilities anyOf={SYSTEM_PLAYLISTS_WRITE}>
                      <PlaylistEditor />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="stack"
                  element={
                    <RequireCapabilities anyOf={OPS_RUNTIME_MANAGE}>
                      <Stack />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="genres"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Genres />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="genres/:slug"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Genres />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="timeline"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Timeline />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="users"
                  element={
                    <RequireCapabilities anyOf={USERS_VIEW}>
                      <Users />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="roles"
                  element={
                    <RequireCapabilities anyOf={ROLES_VIEW}>
                      <Roles />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="discover"
                  element={
                    <RequireCapabilities anyOf={LIBRARY_VIEW}>
                      <Discover />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="i18n"
                  element={
                    <RequireCapabilities anyOf={ADMIN_ACCESS}>
                      <I18nReview />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <RequireCapabilities anyOf={SETTINGS_MANAGE}>
                      <Settings />
                    </RequireCapabilities>
                  }
                />
                <Route path="profile" element={<ProfileRedirect />} />
                <Route
                  path="new-releases"
                  element={
                    <RequireCapabilities anyOf={RELEASE_CURATION}>
                      <NewReleases />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="upcoming"
                  element={
                    <RequireCapabilities anyOf={UPCOMING_CURATION}>
                      <Upcoming />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="bandcamp"
                  element={
                    <RequireCapabilities anyOf={BANDCAMP_MANAGE}>
                      <Bandcamp />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="federation"
                  element={
                    <RequireCapabilities anyOf={FEDERATION_NODES_VIEW}>
                      <Federation />
                    </RequireCapabilities>
                  }
                />
                <Route
                  path="global-catalog"
                  element={
                    <RequireCapabilities anyOf={FEDERATION_NODES_VIEW}>
                      <GlobalCatalog />
                    </RequireCapabilities>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </TooltipProvider>
        <Toaster theme="dark" position="bottom-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}
