import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Shield } from "@crate/ui/icons";

import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";
import {
  AccountProfileForm,
  ConnectedAccounts,
  PasswordChangeForm,
} from "@/components/settings/AccountSectionForms";
import { Section } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface AuthProviderState {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

interface AuthPublicConfig {
  invite_only?: boolean;
}

export function AccountSection() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [providers, setProviders] = useState<Record<string, AuthProviderState>>(
    {},
  );
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig>({});
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setBio(user?.bio || "");
  }, [user?.bio, user?.name, user?.username]);

  useEffect(() => {
    api<Record<string, AuthProviderState>>("/api/auth/providers")
      .then(setProviders)
      .catch(() => {});
    api<AuthPublicConfig>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  async function handleSaveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", {
        name: name.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
      });
      toast.success(t("settings.account.toasts.profileUpdated"));
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Username is already taken")) {
        toast.error(t("settings.account.toasts.usernameTaken"));
      } else {
        toast.error(t("settings.account.toasts.profileUpdateFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      toast.error(t("settings.account.toasts.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.account.toasts.passwordMismatch"));
      return;
    }
    setSaving(true);
    try {
      await api("/api/me/password", "PUT", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success(t("settings.account.toasts.passwordChanged"));
      setShowPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error(t("settings.account.toasts.passwordChangeFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkProvider(provider: string) {
    setLinkingProvider(provider);
    try {
      const response = await api<{ login_url: string }>(
        `/api/auth/oauth/${provider}/link`,
        "POST",
        {
          return_to: `${window.location.origin}/settings`,
        },
      );
      window.location.href = response.login_url;
    } catch {
      toast.error(t("settings.account.toasts.linkFailed", { provider }));
      setLinkingProvider(null);
    }
  }

  async function handleUnlinkProvider(provider: string) {
    setUnlinkingProvider(provider);
    try {
      await api(`/api/auth/oauth/${provider}/unlink`, "POST");
      toast.success(t("settings.account.toasts.unlinked", { provider }));
      await refetch();
    } catch {
      toast.error(t("settings.account.toasts.unlinkFailed", { provider }));
    } finally {
      setUnlinkingProvider(null);
    }
  }

  const connectedAccounts = user?.connected_accounts || [];
  const linkedProviders = new Set<string>();
  for (const item of connectedAccounts) {
    if (item.status !== "unlinked") linkedProviders.add(item.provider);
  }
  const socialProviders = Object.entries(providers).filter(
    ([provider, state]) =>
      provider !== "password" && state.configured && state.enabled,
  );

  return (
    <Section
      title={t("settings.account.title")}
      description={t("settings.account.description")}
    >
      <div className="space-y-4">
        <AccountProfileForm
          name={name}
          username={username}
          bio={bio}
          email={user?.email}
          saving={saving}
          profileUnchanged={
            name.trim() === (user?.name || "") &&
            username.trim() === (user?.username || "") &&
            bio.trim() === (user?.bio || "")
          }
          setName={setName}
          setUsername={setUsername}
          setBio={setBio}
          onSave={handleSaveName}
        />
        <ConnectedAccounts
          providers={socialProviders}
          linkedProviders={linkedProviders}
          linkingProvider={linkingProvider}
          unlinkingProvider={unlinkingProvider}
          onLink={handleLinkProvider}
          onUnlink={handleUnlinkProvider}
        />
        <ConnectDevicesSection />
        {authConfig.invite_only ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent-action/20 bg-accent-action/10 px-4 py-3 text-sm text-accent-action">
            <Shield size={16} className="mt-0.5 shrink-0" />
            <div>{t("settings.account.inviteOnlyNotice")}</div>
          </div>
        ) : null}
        <PasswordChangeForm
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          currentPassword={currentPassword}
          newPassword={newPassword}
          confirmPassword={confirmPassword}
          setCurrentPassword={setCurrentPassword}
          setNewPassword={setNewPassword}
          setConfirmPassword={setConfirmPassword}
          saving={saving}
          onChangePassword={handleChangePassword}
        />
      </div>
    </Section>
  );
}
