import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { Shell } from "@/components/layout/Shell";
import { Loader2 } from "lucide-react";

const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Browse = lazy(() => import("@/pages/Browse").then(m => ({ default: m.Browse })));
const Artist = lazy(() => import("@/pages/Artist").then(m => ({ default: m.Artist })));
const Album = lazy(() => import("@/pages/Album").then(m => ({ default: m.Album })));
const Health = lazy(() => import("@/pages/Health").then(m => ({ default: m.Health })));
const Duplicates = lazy(() => import("@/pages/Duplicates").then(m => ({ default: m.Duplicates })));
const Artwork = lazy(() => import("@/pages/Artwork").then(m => ({ default: m.Artwork })));
const Organizer = lazy(() => import("@/pages/Organizer").then(m => ({ default: m.Organizer })));
const Imports = lazy(() => import("@/pages/Imports").then(m => ({ default: m.Imports })));
const Analytics = lazy(() => import("@/pages/Analytics").then(m => ({ default: m.Analytics })));
const MissingAlbums = lazy(() => import("@/pages/MissingAlbums").then(m => ({ default: m.MissingAlbums })));
const Quality = lazy(() => import("@/pages/Quality").then(m => ({ default: m.Quality })));
const Tasks = lazy(() => import("@/pages/Tasks").then(m => ({ default: m.Tasks })));
const Playlists = lazy(() => import("@/pages/Playlists").then(m => ({ default: m.Playlists })));
const Stack = lazy(() => import("@/pages/Stack").then(m => ({ default: m.Stack })));
const Genres = lazy(() => import("@/pages/Genres").then(m => ({ default: m.Genres })));
const Timeline = lazy(() => import("@/pages/Timeline").then(m => ({ default: m.Timeline })));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PlayerProvider>
        <TooltipProvider>
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<Dashboard />} />
                <Route path="browse" element={<Browse />} />
                <Route path="artist/:name" element={<Artist />} />
                <Route path="album/:artist/:album" element={<Album />} />
                <Route path="health" element={<Health />} />
                <Route path="duplicates" element={<Duplicates />} />
                <Route path="artwork" element={<Artwork />} />
                <Route path="organizer" element={<Organizer />} />
                <Route path="imports" element={<Imports />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="missing-albums" element={<MissingAlbums />} />
                <Route path="quality" element={<Quality />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="playlists" element={<Playlists />} />
                <Route path="stack" element={<Stack />} />
                <Route path="genres" element={<Genres />} />
                <Route path="timeline" element={<Timeline />} />
              </Route>
            </Routes>
          </Suspense>
        </TooltipProvider>
        <Toaster theme="dark" position="bottom-right" richColors />
      </PlayerProvider>
    </BrowserRouter>
  );
}
