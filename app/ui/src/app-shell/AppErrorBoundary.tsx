import React, { type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function AdminCrashFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-6 text-foreground">
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
          Admin crashed
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Something went wrong while rendering.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This is usually caused by a stale dev chunk or a page-level runtime error.
          Reloading clears the current UI tree and asks Vite for fresh modules.
        </p>
        <pre className="mt-5 max-h-40 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-white/70">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={onReset}
          className="mt-5 inline-flex h-10 items-center rounded-md border border-white/12 bg-white/8 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/12"
        >
          Reload admin
        </button>
      </div>
    </div>
  );
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Admin render failed", error, info);
  }

  private handleReset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <AdminCrashFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
