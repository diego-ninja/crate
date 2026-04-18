import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, LogOut, Radio, Settings, Upload, User, Users } from "lucide-react";
import { useNavigate } from "react-router";

import { AppMenuButton, AppPopover, AppPopoverDivider } from "@/components/ui/AppPopover";
import { AppModal, ModalBody } from "@/components/ui/AppModal";
import { useAuth } from "@/contexts/AuthContext";
import { useIsDesktop } from "@/hooks/use-breakpoint";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  useDismissibleLayer({
    active: showUserMenu && isDesktop,
    refs: [userMenuRef, userMenuButtonRef],
    onDismiss: () => setShowUserMenu(false),
  });

  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;
  const profilePath = user?.username ? `/users/${user.username}` : "/settings";

  function go(path: string) {
    setShowUserMenu(false);
    navigate(path);
  }

  const menuContent = (
    <>
      <div className="px-3 pb-2 pt-2">
        <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-white/60">
              {userInitial || <User size={14} />}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-white/85 truncate">{userName || "Signed in"}</p>
            {user?.email ? (
              <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
            ) : null}
          </div>
        </div>
      </div>
      <AppPopoverDivider />
      <AppMenuButton onClick={() => go(profilePath)} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <User size={14} /> Profile
      </AppMenuButton>
      <AppMenuButton onClick={() => go("/people")} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <Users size={14} /> People
      </AppMenuButton>
      <AppMenuButton onClick={() => go("/jam")} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <Radio size={14} /> Jam sessions
      </AppMenuButton>
      <AppMenuButton onClick={() => go("/upload")} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <Upload size={14} /> Upload music
      </AppMenuButton>
      <AppMenuButton onClick={() => go("/stats")} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <BarChart3 size={14} /> Stats
      </AppMenuButton>
      <AppMenuButton onClick={() => go("/settings")} className="gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white">
        <Settings size={14} /> Settings
      </AppMenuButton>
      <AppPopoverDivider />
      <AppMenuButton onClick={() => { setShowUserMenu(false); void logout(); }} className="gap-2.5 px-3 py-2 text-[13px]" danger>
        <LogOut size={14} /> Sign out
      </AppMenuButton>
    </>
  );

  return (
    <>
      <div className="relative pointer-events-auto">
        <button
          ref={userMenuButtonRef}
          onClick={() => setShowUserMenu(!showUserMenu)}
          aria-label="User menu"
          className="flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-full border border-white/10 bg-black/30 backdrop-blur-sm text-sm font-medium text-white/70 transition-colors hover:bg-black/50 hover:text-white overflow-hidden shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
          ) : userInitial || <User size={18} />}
        </button>

        {showUserMenu && isDesktop && (
          <AppPopover ref={userMenuRef} className="absolute right-0 top-full mt-2 w-60 py-1">
            {menuContent}
          </AppPopover>
        )}
      </div>

      {showUserMenu && !isDesktop && createPortal(
        <AppModal open={showUserMenu} onClose={() => setShowUserMenu(false)} maxWidthClassName="sm:max-w-sm">
          <ModalBody className="py-2">
            {menuContent}
          </ModalBody>
        </AppModal>,
        document.body,
      )}
    </>
  );
}
