import React from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { DeferredRoute } from "@/app-shell/AppFallbacks";
import { ArtistChildRoute, LegacyArtistTopTracksRedirect } from "@/app-shell/LibraryRouteCompat";
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

export interface AppRouteDefinition {
  path?: string;
  index?: true;
  element: ReactNode;
}

function deferred(element: ReactNode) {
  return <DeferredRoute>{element}</DeferredRoute>;
}

export const publicAppRoutes: AppRouteDefinition[] = [
  { path: "/server-setup", element: deferred(<ServerSetup />) },
  { path: "/auth/callback", element: deferred(<AuthCallback />) },
  { path: "/login", element: deferred(<Login />) },
  { path: "/register", element: deferred(<Register />) },
];

export const protectedAppRoutes: AppRouteDefinition[] = [
  { index: true, element: <Home /> },
  { path: "explore", element: deferred(<Explore />) },
  { path: "search", element: deferred(<SearchResults />) },
  { path: "library", element: deferred(<Library />) },
  { path: "stats", element: deferred(<Stats />) },
  { path: "upload", element: deferred(<Upload />) },
  { path: "settings", element: deferred(<Settings />) },
  { path: "people", element: deferred(<People />) },
  { path: "users/:username", element: deferred(<UserProfile />) },
  { path: "users/:username/followers", element: deferred(<UserConnections />) },
  { path: "users/:username/following", element: deferred(<UserConnections />) },
  { path: "jam", element: deferred(<JamSession />) },
  { path: "jam/rooms/:roomId", element: deferred(<JamSession />) },
  { path: "jam/invite/:token", element: deferred(<JamInvite />) },
  { path: "playlist/invite/:token", element: deferred(<PlaylistInvite />) },
  { path: "shows", element: <Navigate to="/upcoming" replace /> },
  { path: "upcoming", element: deferred(<Shows />) },
  { path: "paths", element: deferred(<PathsPage />) },
  { path: "paths/:id", element: deferred(<PathDetailPage />) },
  { path: "radio", element: deferred(<RadioPage />) },
  { path: "artists/:artistId/:legacySlug/top-tracks", element: deferred(<LegacyArtistTopTracksRedirect />) },
  { path: "artists/:artistSlug/top-tracks", element: deferred(<ArtistTopTracks />) },
  { path: "artists/:artistSlug/:albumSlug", element: deferred(<ArtistChildRoute />) },
  { path: "artists/:artistSlug", element: deferred(<Artist />) },
  { path: "albums/:albumId/:slug", element: deferred(<Album />) },
  { path: "playlist/:id", element: deferred(<Playlist />) },
  { path: "home/playlist/:playlistId", element: deferred(<HomePlaylist />) },
  { path: "home/section/:sectionId", element: deferred(<HomeSection />) },
  { path: "curation/playlist/:id", element: deferred(<CuratedPlaylist />) },
];
