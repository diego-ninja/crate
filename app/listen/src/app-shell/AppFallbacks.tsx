import { Suspense, type ReactNode } from "react";

import { Loader2 } from "lucide-react";

export function RouteSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
    </div>
  );
}

export function AuthSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface">
      <Loader2 size={22} className="animate-spin text-primary" />
    </div>
  );
}

export function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteSpinner />}>{children}</Suspense>;
}
