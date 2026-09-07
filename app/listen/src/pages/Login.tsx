import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { isTauriRuntime } from "@/lib/platform";
import {
  getTauriAuthDiagnostic,
  TAURI_AUTH_DIAGNOSTIC_EVENT,
  type TauriAuthDiagnostic,
} from "@/lib/tauri-auth-diagnostic";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return_to") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<{ invite_only?: boolean }>({});
  const [tauriAuthDiagnostic, setTauriAuthDiagnostic] =
    useState<TauriAuthDiagnostic | null>(() =>
      isTauriRuntime ? getTauriAuthDiagnostic() : null,
    );

  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const handleDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<TauriAuthDiagnostic>).detail;
      if (detail) setTauriAuthDiagnostic(detail);
    };
    window.addEventListener(TAURI_AUTH_DIAGNOSTIC_EVENT, handleDiagnostic);
    return () => {
      window.removeEventListener(TAURI_AUTH_DIAGNOSTIC_EVENT, handleDiagnostic);
    };
  }, []);

  if (authLoading) {
    return <CrateLoader variant="screen" label={t("common.loading")} />;
  }

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await api<{
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      }>("/api/auth/login", "POST", { email, password });
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
          setError(parsed.detail || t("auth.login.invalidCredentials"));
        } catch {
          setError(err.message || t("auth.login.invalidCredentials"));
        }
      } else {
        setError(t("auth.login.connectionError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <img src="/icons/logo.svg" alt="Crate" className=" size-16 mb-2" />
          <h1 className="text-2xl font-bold text-text-primary">Crate</h1>
          <p className="text-sm text-text-primary/40 -mt-0.5">
            {t("auth.tagline")}
          </p>
        </div>

        {authConfig.invite_only ? (
          <div className="rounded-xl border border-accent-action/20 bg-accent-action/10 px-4 py-3 text-sm text-text-accent">
            {t("auth.login.inviteOnly")}
          </div>
        ) : null}

        {error && (
          <p className="text-sm text-state-danger text-center">{error}</p>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-sm text-text-primary/60 mb-1"
          >
            {t("common.email")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-10 w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 text-base text-text-primary focus:border-accent-action/50 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm text-text-primary/60 mb-1"
          >
            {t("common.password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-10 w-full rounded-lg border border-border-quiet bg-text-primary/5 px-3 text-base text-text-primary focus:border-accent-action/50 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-10 rounded-lg bg-accent-action text-accent-action-foreground font-medium text-sm hover:bg-accent-action-hover transition-colors disabled:opacity-50"
        >
          {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>

        <OAuthButtons returnTo={returnTo} />

        {tauriAuthDiagnostic ? (
          <div className="rounded-lg border border-border-quiet bg-text-primary/[0.03] px-3 py-2 text-xs text-text-primary/45">
            <span className="text-text-primary/65">Desktop OAuth:</span>{" "}
            {tauriAuthDiagnostic.status}
            {tauriAuthDiagnostic.detail
              ? ` · ${tauriAuthDiagnostic.detail}`
              : ""}
          </div>
        ) : null}

        <p className="text-center text-sm text-text-primary/40">
          {t("auth.login.noAccount")}{" "}
          <Link
            to={`/register?return_to=${encodeURIComponent(returnTo)}`}
            className="text-accent-action hover:underline"
          >
            {t("auth.login.createOne")}
          </Link>
        </p>
      </form>
    </div>
  );
}
