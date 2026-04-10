import { useRef, useState } from "react";
import { BarChart3, LogOut, Settings, Upload, User } from "lucide-react";
import { useNavigate } from "react-router";

import { AppMenuButton, AppPopover, AppPopoverDivider } from "@/components/ui/AppPopover";
import { useAuth } from "@/contexts/AuthContext";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  useDismissibleLayer({
    active: showUserMenu,
    refs: [userMenuRef, userMenuButtonRef],
    onDismiss: () => setShowUserMenu(false),
  });

  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;

  return (
    <div className="relative pointer-events-auto">
      <button
        ref={userMenuButtonRef}
        onClick={() => setShowUserMenu(!showUserMenu)}
        aria-label="User menu"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-sm font-medium text-white/60 transition-colors hover:bg-black/50 hover:text-white"
      >
        {userInitial || <User size={16} />}
      </button>

      {showUserMenu ? (
        <AppPopover ref={userMenuRef} className="absolute right-0 top-full mt-2 w-60 py-1">
          <div className="px-3 pb-2 pt-2">
            <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/65">
              <p className="font-medium text-white/85">{userName || "Signed in"}</p>
              {user?.email ? (
                <p className="mt-1 truncate text-[10px] opacity-80">{user.email}</p>
              ) : null}
            </div>
          </div>
          <AppPopoverDivider />
          <AppMenuButton
            onClick={() => {
              setShowUserMenu(false);
              navigate("/library");
            }}
            className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
          >
            <User size={14} />
            Profile
          </AppMenuButton>
          <AppMenuButton
            onClick={() => {
              setShowUserMenu(false);
              navigate("/upload");
            }}
            className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
          >
            <Upload size={14} />
            Upload music
          </AppMenuButton>
          <AppMenuButton
            onClick={() => {
              setShowUserMenu(false);
              navigate("/stats");
            }}
            className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
          >
            <BarChart3 size={14} />
            Stats
          </AppMenuButton>
          <AppMenuButton
            onClick={() => {
              setShowUserMenu(false);
              navigate("/settings");
            }}
            className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
          >
            <Settings size={14} />
            Settings
          </AppMenuButton>
          <AppPopoverDivider />
          <AppMenuButton
            onClick={() => {
              setShowUserMenu(false);
              void logout();
            }}
            className="gap-2.5 px-3 py-2 text-[13px]"
            danger
          >
            <LogOut size={14} />
            Sign out
          </AppMenuButton>
        </AppPopover>
      ) : null}
    </div>
  );
}
