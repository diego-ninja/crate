import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";

import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

export function Login() {
  const { user, loading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<{ invite_only?: boolean }>({});

  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
        <div className="h-6 w-6 animate-spin rounded-md border-2 border-cyan-400 border-t-transparent" />
      </div>
    );
  }

  if (user) {
    if (redirectTo) {
      window.location.href = redirectTo;
      return null;
    }
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await api("/api/auth/login", "POST", { email, password });
      if (redirectTo) {
        window.location.href = redirectTo;
        return;
      }
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message);
          setError(parsed.detail || "Invalid credentials");
        } catch {
          setError(err.message || "Invalid credentials");
        }
      } else {
        setError("Connection error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <img src="/assets/logo.svg" alt="Crate" className="mb-2 h-16 w-16" />
          <h1 className="text-2xl font-bold text-white">Crate</h1>
          <p className="-mt-0.5 text-sm text-white/40">Own your music</p>
        </div>

        {authConfig.invite_only ? (
          <div className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            New accounts are invite-only right now. If you already have access, sign in below or use your social provider.
          </div>
        ) : null}

        {error ? (
          <p className="text-center text-sm text-red-400">{error}</p>
        ) : null}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-white/60">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-white/60">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="h-10 w-full rounded-md bg-cyan-400 text-sm font-medium text-black transition-colors hover:bg-cyan-300 disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <OAuthButtons returnTo={redirectTo} />
      </form>
    </div>
  );
}
