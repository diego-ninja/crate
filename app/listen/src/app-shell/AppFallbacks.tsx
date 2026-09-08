import { Suspense, type ReactNode } from "react";

import { CrateLoader } from "@/components/ui/CrateLoader";

export function RouteSpinner() {
  return <CrateLoader variant="compact" className="py-20" />;
}

export function AuthSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
      <CrateLoader variant="screen" />
    </div>
  );
}

export function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteSpinner />}>{children}</Suspense>;
}
