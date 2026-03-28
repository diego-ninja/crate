import React, { Suspense } from "react";
import { Routes, Route } from "react-router";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { Shell } from "@/components/layout/Shell";
import { Home } from "@/pages/Home";
import { Explore } from "@/pages/Explore";
import { Library } from "@/pages/Library";
import { Shows } from "@/pages/Shows";
import { Login } from "@/pages/Login";

const Artist = React.lazy(() =>
  import("@/pages/Artist").then((m) => ({ default: m.Artist })),
);
const Album = React.lazy(() =>
  import("@/pages/Album").then((m) => ({ default: m.Album })),
);
const Playlist = React.lazy(() =>
  import("@/pages/Playlist").then((m) => ({ default: m.Playlist })),
);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function App() {
  return (
    <PlayerProvider>
      <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
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
          </Route>
        </Routes>
      </PlayerProvider>
  );
}
