import { Route, Routes } from "react-router";

import { AppProviders } from "@/app-shell/AppProviders";
import { ProtectedRoute, ServerGate } from "@/app-shell/RouteGuards";
import {
  protectedAppRoutes,
  publicAppRoutes,
  type AppRouteDefinition,
} from "@/app-shell/route-table";
import { Shell } from "@/components/layout/Shell";

function renderRoute(route: AppRouteDefinition) {
  if (route.index) {
    return <Route key="index" index element={route.element} />;
  }
  return <Route key={route.path} path={route.path} element={route.element} />;
}

export function AppRouter() {
  return (
    <ServerGate>
      <Routes>
        {publicAppRoutes.map(renderRoute)}
        <Route
          element={(
            <ProtectedRoute>
              <AppProviders>
                <Shell />
              </AppProviders>
            </ProtectedRoute>
          )}
        >
          {protectedAppRoutes.map(renderRoute)}
        </Route>
      </Routes>
    </ServerGate>
  );
}
