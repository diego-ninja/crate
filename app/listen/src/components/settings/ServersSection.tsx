import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Trash2, Server, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { isNative } from "@/lib/capacitor";
import {
  getCurrentServerId,
  getServers,
  removeServer,
  SERVER_STORE_EVENT,
  setCurrentServerId,
  type ServerConfig,
} from "@/lib/server-store";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Settings panel listing configured Crate servers. Only rendered in
 * Capacitor builds — on web, there's always a single implicit server
 * (the one that served the app) so this UI would be confusing.
 *
 * Switching server drops the app back to the login screen for that
 * instance. Removing the active server clears its token and bounces
 * back to the setup screen if it was the only one.
 */
export function ServersSection() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setServers(getServers());
      setCurrentId(getCurrentServerId());
    };
    sync();
    window.addEventListener(SERVER_STORE_EVENT, sync);
    return () => window.removeEventListener(SERVER_STORE_EVENT, sync);
  }, []);

  if (!isNative) return null;

  const handleSwitch = async (server: ServerConfig) => {
    if (server.id === currentId) return;
    setCurrentServerId(server.id);
    // Force a full re-auth against the new server. If the stored token
    // is still valid we land back in the app; if not, login screen.
    toast.success(`Switched to ${server.label}`);
    if (server.token) {
      // Reload so all in-flight queries drop and re-hit the new host.
      window.location.href = "/";
    } else {
      navigate("/login", { replace: true });
    }
  };

  const handleRemove = async (server: ServerConfig) => {
    const wasCurrent = server.id === currentId;
    removeServer(server.id);
    toast.success(`Removed ${server.label}`);
    if (wasCurrent) {
      // Currently-logged-in server was removed. Logout flushes local
      // state and navigates to /login; ServerGate then bounces to
      // /server-setup if there are no remaining servers.
      await logout().catch(() => {});
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Server size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-foreground">Servers</h2>
      </div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        Crate servers this app can talk to. Switching drops you back to the login screen for the new host.
      </p>

      <div className="space-y-2">
        {servers.map((server) => {
          const isCurrent = server.id === currentId;
          return (
            <div
              key={server.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                isCurrent
                  ? "border-cyan-400/40 bg-cyan-400/10"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <button
                type="button"
                onClick={() => handleSwitch(server)}
                className="flex-1 text-left"
                disabled={isCurrent}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isCurrent ? "text-cyan-100" : "text-white"}`}>
                    {server.label}
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                      <CheckCircle2 size={10} />
                      Current
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{server.url}</div>
              </button>
              <button
                type="button"
                onClick={() => handleRemove(server)}
                aria-label={`Remove ${server.label}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-200"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => navigate("/server-setup")}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-200"
      >
        <Plus size={14} />
        Add another server
      </button>
    </section>
  );
}
