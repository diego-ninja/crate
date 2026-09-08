import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

export function Register() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  // Invite links are intentionally prefilled; the API validates the token
  // before creating an account.
  // react-doctor-disable-next-line url-prefilled-privileged-action
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
    return <CrateLoader variant="screen" label={t("common.loading")} />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      }>("/api/auth/register", "POST", {
        email,
        password,
        name,
        invite_token: inviteToken,
      });
      if (res?.token) {
        setAuthTokens(
          res.token,
          res.refresh_token ?? undefined,
          res.access_expires_at ?? undefined,
        );
        try {
          await waitForPendingSecureSessionWrites();
        } catch (error) {
          setAuthTokens(null, null, null);
          throw error;
        }
      }
      await refetch();
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message);
          setError(parsed.detail || t("auth.register.failed"));
        } catch {
          setError(err.message || t("auth.register.failed"));
        }
      } else {
        setError(t("auth.register.failed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <CrateLogo title="Crate" className="mb-2 size-16" />
          <h1 className="text-2xl font-bold text-text-primary">
            {t("auth.register.title")}
          </h1>
          <p className="text-sm text-text-primary/40 -mt-0.5">
            {t("auth.tagline")}
          </p>
        </div>

        {inviteOnly ? (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              inviteToken
                ? "border border-accent-action/20 bg-accent-action/10 text-text-accent"
                : "border border-state-warning/20 bg-state-warning/10 text-state-warning-text"
            }`}
          >
            {inviteToken
              ? t("auth.register.inviteApplied")
              : t("auth.register.inviteOnly")}
          </div>
        ) : null}

        {error && (
          <p className="text-sm text-state-danger text-center">{error}</p>
        )}

        <div>
          <label
            htmlFor="reg-name"
            className="block text-sm text-text-primary/60 mb-1"
          >
            {t("common.name")}
          </label>
          <input
            id="reg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-10 w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 text-base text-text-primary focus:border-accent-action/50 focus:outline-none"
            placeholder={t("auth.register.namePlaceholder")}
          />
        </div>
        <div>
          <label
            htmlFor="reg-email"
            className="block text-sm text-text-primary/60 mb-1"
          >
            {t("common.email")}
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-10 w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 text-base text-text-primary focus:border-accent-action/50 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label
            htmlFor="reg-password"
            className="block text-sm text-text-primary/60 mb-1"
          >
            {t("common.password")}
          </label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-10 w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 text-base text-text-primary focus:border-accent-action/50 focus:outline-none"
            placeholder={t("auth.register.passwordPlaceholder")}
          />
        </div>

        <button
          type="submit"
          disabled={loading || (inviteOnly && !inviteToken)}
          className="w-full h-10 rounded-lg bg-accent-action text-accent-action-foreground font-medium text-sm hover:bg-accent-action-hover transition-colors disabled:opacity-50"
        >
          {loading ? t("auth.register.submitting") : t("auth.register.submit")}
        </button>

        <OAuthButtons returnTo={returnTo} inviteToken={inviteToken} />

        <p className="text-center text-sm text-text-primary/40">
          {t("auth.register.hasAccount")}{" "}
          <Link
            to={`/login?return_to=${encodeURIComponent(returnTo)}`}
            className="text-accent-action hover:underline"
          >
            {t("auth.login.submit")}
          </Link>
        </p>
      </form>
    </div>
  );
}
