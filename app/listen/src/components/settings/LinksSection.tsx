import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { BarChart3, LogOut, Upload, Users } from "@crate/ui/icons";

import { Section } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";

export function LinksSection() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const publicProfilePath = useMemo(() => {
    return user?.username ? `/users/${user.username}` : "/people";
  }, [user?.username]);

  return (
    <Section title={t("settings.links.title")}>
      <div className="flex flex-col gap-2">
        <Link
          to={publicProfilePath}
          className="flex items-center gap-3 rounded-xl p-3 text-sm text-text-primary transition-colors hover:bg-text-primary/5"
        >
          <Users size={18} className="text-text-muted" />{" "}
          {t("settings.links.profile")}
        </Link>
        <Link
          to="/people"
          className="flex items-center gap-3 rounded-xl p-3 text-sm text-text-primary transition-colors hover:bg-text-primary/5"
        >
          <Users size={18} className="text-text-muted" />{" "}
          {t("settings.links.people")}
        </Link>
        <Link
          to="/upload"
          className="flex items-center gap-3 rounded-xl p-3 text-sm text-text-primary transition-colors hover:bg-text-primary/5"
        >
          <Upload size={18} className="text-text-muted" /> {t("upload.badge")}
        </Link>
        <Link
          to="/stats"
          className="hidden items-center gap-3 rounded-xl p-3 text-sm text-text-primary transition-colors hover:bg-text-primary/5 md:flex"
        >
          <BarChart3 size={18} className="text-text-muted" />{" "}
          {t("settings.links.stats")}
        </Link>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm text-state-danger transition-colors hover:bg-text-primary/5"
        >
          <LogOut size={18} /> {t("auth.logout")}
        </button>
      </div>
    </Section>
  );
}
