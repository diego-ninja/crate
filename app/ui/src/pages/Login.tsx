import { useState, useEffect, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [authConfig, setAuthConfig] = useState<{ google?: boolean; discogs?: boolean }>({});

  useEffect(() => {
    api<{ google: boolean; discogs: boolean }>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
        setError(err.message || "Invalid credentials");
      } else {
        setError("Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasOAuth = authConfig.google || authConfig.discogs;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/assets/logo.svg" alt="Crate" className="w-20 mb-2" />
          <h1 className="text-2xl font-bold text-foreground">Crate</h1>
          <p className="text-sm text-muted-foreground -mt-0.5">Own your music</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-8 shadow-xl">

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>
            <div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          {hasOAuth && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <div className="space-y-2">
                {authConfig.google && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { window.location.href = "/api/auth/google"; }}
                  >
                    Sign in with Google
                  </Button>
                )}
                {authConfig.discogs && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { window.location.href = "/api/auth/discogs"; }}
                  >
                    Sign in with Discogs
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
