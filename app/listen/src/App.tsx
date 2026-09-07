import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
import { AppRouter } from "@/app-shell/AppRouter";
import { AuthProvider } from "@/contexts/AuthContext";
import { captureRenderError } from "@/lib/sentry";

export function App() {
  return (
    <AppErrorBoundary onError={captureRenderError}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
