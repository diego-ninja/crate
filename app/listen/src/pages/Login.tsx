import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { api, ApiError, setAuthToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export function Login() {
  const navigate = useNavigate();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return_to") || "/";
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

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await api<{ token?: string }>("/api/auth/login", "POST", { email, password });
      if (res?.token) setAuthToken(res.token);
      await refetch();
      navigate(returnTo, { replace: true });
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
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5"
      >
        <div className="flex flex-col items-center pb-4">
          <img src="/icons/logo.svg" alt="Crate" className="h-16 w-16 mb-2" />
          <h1 className="text-2xl font-bold text-white">Crate</h1>
          <p className="text-sm text-white/40 -mt-0.5">Own your music</p>
        </div>

        {authConfig.invite_only ? (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            New accounts are invite-only right now. If you are joining a private beta, open your invite link to register.
          </div>
        ) : null}

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <div>
          <label htmlFor="email" className="block text-sm text-white/60 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-white/60 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-10 rounded-lg bg-cyan-400 text-black font-medium text-sm hover:bg-cyan-300 transition-colors disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <OAuthButtons returnTo={returnTo} />

        <p className="text-center text-sm text-white/40">
          No account?{" "}
          <Link to={`/register?return_to=${encodeURIComponent(returnTo)}`} className="text-primary hover:underline">Create one</Link>
        </p>
      </form>
    </div>
  );
}
