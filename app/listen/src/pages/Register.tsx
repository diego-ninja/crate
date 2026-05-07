import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export function Register() {
  const navigate = useNavigate();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") || undefined;
  const returnTo = searchParams.get("return_to") || "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteOnly, setInviteOnly] = useState(false);
  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then((config) => setInviteOnly(Boolean(config.invite_only)))
      .catch(() => {});
  }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{ token?: string; refresh_token?: string | null }>("/api/auth/register", "POST", { email, password, name, invite_token: inviteToken });
      if (res?.token) setAuthTokens(res.token, res.refresh_token ?? undefined);
      await refetch();
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message);
          setError(parsed.detail || "Registration failed");
        } catch {
          setError(err.message || "Registration failed");
        }
      } else {
        setError("Registration failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <img src="/icons/logo.svg" alt="Crate" className="h-16 w-16 mb-2" />
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
          <p className="text-sm text-white/40 -mt-0.5">Own your music</p>
        </div>

        {inviteOnly ? (
          <div className={`rounded-xl px-4 py-3 text-sm ${inviteToken ? "border border-cyan-400/20 bg-cyan-400/10 text-cyan-100" : "border border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>
            {inviteToken
              ? "This invite will be applied when your account is created."
              : "This instance is invite-only right now. Open a valid invite link to continue."}
          </div>
        ) : null}

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <div>
          <label htmlFor="reg-name" className="block text-sm text-white/60 mb-1">Name</label>
          <input
            id="reg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="reg-email" className="block text-sm text-white/60 mb-1">Email</label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="reg-password" className="block text-sm text-white/60 mb-1">Password</label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
            placeholder="Min 6 characters"
          />
        </div>

        <button
          type="submit"
          disabled={loading || (inviteOnly && !inviteToken)}
          className="w-full h-10 rounded-lg bg-cyan-400 text-black font-medium text-sm hover:bg-cyan-300 transition-colors disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Account"}
        </button>

        <OAuthButtons returnTo={returnTo} inviteToken={inviteToken} />

        <p className="text-center text-sm text-white/40">
          Already have an account?{" "}
          <Link to={`/login?return_to=${encodeURIComponent(returnTo)}`} className="text-primary hover:underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
