import React, { type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function DefaultFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app-surface text-white">
      <p className="text-lg font-medium">Something went wrong</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={onReset}
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-white"
      >
        Go home
      </button>
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

  private handleReset = () => {
    this.setState({ error: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <DefaultFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
