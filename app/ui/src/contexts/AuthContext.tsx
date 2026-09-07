import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { setSentryUser } from "@/lib/sentry";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  roles?: string[];
  avatar?: string;
  username?: string | null;
  bio?: string | null;
  capabilities?: string[];
  connected_accounts?: Array<{ provider: string; status: string }>;
}

export interface RolePreset {
  slug: string;
  name: string;
  capabilities: string[];
  system?: boolean;
}

export const ADMIN_CONSOLE_ENTRY_CAPABILITIES = [
  "ops.health.view",
  "ops.logs.view",
  "ops.tasks.manage",
  "ops.runtime.manage",
  "settings.manage",
  "auth.manage",
  "audit.view",
  "users.view",
  "roles.view",
  "library.metadata.write",
  "library.analysis.manage",
  "library.track.remove",
  "library.album.remove",
  "library.artist.remove",
  "library.files.delete",
  "library.repair.run",
  "library.import.manage",
  "library.bandcamp.manage",
  "library.tidal.manage",
  "curation.playlists.write",
  "curation.genres.write",
  "curation.shows.write",
  "curation.releases.write",
] as const;

function hasLegacyAdminRole(user: AuthUser | null): boolean {
  const roles = user?.roles?.length
    ? user.roles
    : user?.role
      ? [user.role]
      : [];
  return roles.includes("admin") || roles.includes("owner");
}

export function userHasCapability(
  user: AuthUser | null,
  capability: string,
): boolean {
  if (!user) return false;
  if (hasLegacyAdminRole(user)) return true;
  return Boolean(user.capabilities?.includes(capability));
}

export function userHasAnyCapability(
  user: AuthUser | null,
  capabilities: readonly string[],
): boolean {
  return capabilities.some((capability) => userHasCapability(user, capability));
}

export function userCanAccessAdminConsole(user: AuthUser | null): boolean {
  return (
    userHasCapability(user, "admin.access") ||
    userHasAnyCapability(user, ADMIN_CONSOLE_ENTRY_CAPABILITIES)
  );
}

export interface AuthContextValue {
  user: AuthUser | null;
  actualUser?: AuthUser | null;
  loading: boolean;
  logout: () => void;
  isAdmin: boolean;
  canAccessAdmin: boolean;
  hasCapability: (capability: string) => boolean;
  hasAnyCapability: (capabilities: readonly string[]) => boolean;
  refetch: () => void;
  rolePresets?: RolePreset[];
  previewRole?: string | null;
  setPreviewRole?: (role: string | null) => void;
  clearRolePreview?: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [actualUser, setActualUser] = useState<AuthUser | null>(null);
  const [rolePresets, setRolePresets] = useState<RolePreset[]>([]);
  const [previewRole, setPreviewRoleState] = useState<string | null>(() => {
    try {
      return localStorage.getItem("crate-admin-role-preview") || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const lastHeartbeatAtRef = useRef(0);

  const fetchUser = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/api/auth/me");
      if (data && data.id) setActualUser(data);
      else setActualUser(null);
    } catch {
      setActualUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    setSentryUser(actualUser?.id ?? null);
  }, [actualUser?.id]);

  useEffect(() => {
    if (!actualUser) return;
    async function sendHeartbeat(force = false) {
      if (!force && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastHeartbeatAtRef.current < 55_000) return;
      lastHeartbeatAtRef.current = now;
      await api("/api/auth/heartbeat", "POST", { app_id: "admin-web" }).catch(
        () => {},
      );
    }

    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 60_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sendHeartbeat(true);
      }
    }

    function handleOnline() {
      void sendHeartbeat(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [actualUser]);

  useEffect(() => {
    if (!actualUser || !userHasCapability(actualUser, "roles.view")) {
      setRolePresets([]);
      return;
    }
    let cancelled = false;
    api<{ roles: RolePreset[] }>("/api/auth/roles")
      .then((data) => {
        if (!cancelled) setRolePresets(data.roles ?? []);
      })
      .catch(() => {
        if (!cancelled) setRolePresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [actualUser]);

  const setPreviewRole = useCallback((role: string | null) => {
    const nextRole = role || null;
    setPreviewRoleState(nextRole);
    try {
      if (nextRole) {
        localStorage.setItem("crate-admin-role-preview", nextRole);
      } else {
        localStorage.removeItem("crate-admin-role-preview");
      }
    } catch {
      // ignore persistence failures
    }
  }, []);

  const clearRolePreview = useCallback(() => {
    setPreviewRole(null);
  }, [setPreviewRole]);

  const user = useMemo(() => {
    if (!actualUser || !previewRole) return actualUser;
    const preset = rolePresets.find((role) => role.slug === previewRole);
    if (!preset) return actualUser;
    return {
      ...actualUser,
      role: preset.slug,
      roles: [preset.slug],
      capabilities: preset.capabilities,
    };
  }, [actualUser, previewRole, rolePresets]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      // ignore
    }
    setActualUser(null);
    clearRolePreview();
    navigate("/login");
  }, [clearRolePreview, navigate]);

  const isAdmin = useMemo(
    () => userHasCapability(user, "admin.access"),
    [user],
  );
  const canAccessAdmin = useMemo(() => userCanAccessAdminConsole(user), [user]);
  const hasCapability = useCallback(
    (capability: string) => userHasCapability(user, capability),
    [user],
  );
  const hasAnyCapability = useCallback(
    (capabilities: readonly string[]) =>
      userHasAnyCapability(user, capabilities),
    [user],
  );
  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      actualUser,
      loading,
      logout,
      isAdmin,
      canAccessAdmin,
      hasCapability,
      hasAnyCapability,
      refetch: fetchUser,
      rolePresets,
      previewRole,
      setPreviewRole,
      clearRolePreview,
    }),
    [
      actualUser,
      canAccessAdmin,
      clearRolePreview,
      fetchUser,
      hasAnyCapability,
      hasCapability,
      isAdmin,
      loading,
      logout,
      previewRole,
      rolePresets,
      setPreviewRole,
      user,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}
