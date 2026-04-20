import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { VisuallyHidden } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useKeyboard } from "@/hooks/use-keyboard";
import { useNotifications } from "@/hooks/use-notifications";

import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { SearchBar } from "./SearchBar";
import {
  Sidebar,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EVENT,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_KEY,
  getStoredSidebarExpanded,
} from "./Sidebar";

export function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredSidebarExpanded);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const blurSearch = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const showHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  useKeyboard({
    onFocusSearch: focusSearch,
    onBlurSearch: blurSearch,
    onShowHelp: showHelp,
  });

  useNotifications();

  useEffect(() => {
    const sync = () => setSidebarExpanded(getStoredSidebarExpanded());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SIDEBAR_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SIDEBAR_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SIDEBAR_EVENT, sync as EventListener);
    };
  }, []);

  const overlayHeader =
    /^\/artists\/[^/]+\/[^/]+$/.test(location.pathname) ||
    /^\/albums\/[^/]+\/[^/]+$/.test(location.pathname);
  const sidebarWidthClass = sidebarExpanded ? "md:ml-60" : "md:ml-[4.5rem]";
  const sidebarLeftClass = sidebarExpanded ? "left-60" : "left-[4.5rem]";
  const desktopHeaderOffsetClass = overlayHeader ? "md:pt-0" : "md:pt-24";
  const shellStyle = {
    "--sidebar-w": sidebarExpanded ? `${SIDEBAR_EXPANDED_WIDTH}px` : `${SIDEBAR_COLLAPSED_WIDTH}px`,
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-app-surface text-foreground [--sidebar-w:0px]" style={shellStyle}>
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="z-app-header fixed inset-x-0 top-0 flex items-center gap-3 border-b border-white/6 bg-app-surface/75 px-4 py-3 backdrop-blur-xl md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
        </Button>
        <div className="text-sm font-bold text-white">Crate Admin</div>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[240px] p-0" showCloseButton={false}>
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div
        className={`z-app-header fixed top-0 right-0 hidden border-b border-white/6 bg-app-surface/68 backdrop-blur-xl transition-all duration-200 md:block ${sidebarLeftClass}`}
      >
        <div className="flex h-16 w-full items-center gap-4 px-4 pointer-events-none">
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-black/30 text-white/60 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
              aria-label="Go back"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="flex h-10 w-10 items-center justify-center rounded-md bg-black/30 text-white/60 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
              aria-label="Go forward"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="hidden flex-1 lg:block" />

          <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-4">
            <SearchBar inputRef={searchInputRef} />
            <NotificationBell />
          </div>
        </div>
      </div>

      <main className={`overflow-x-hidden transition-all duration-200 ${sidebarWidthClass}`}>
        <div className={`mx-auto w-full max-w-[1440px] px-4 py-4 pt-20 md:py-6 ${overlayHeader ? "md:px-0" : sidebarExpanded ? "md:px-6" : "md:px-10"} ${desktopHeaderOffsetClass}`}>
          <div key={location.pathname} className="animate-page-in">
            <Outlet />
          </div>
        </div>
      </main>

      <CommandPalette />

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>Navigate the admin console quickly with your keyboard.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <Shortcut keys={["/"]} label="Focus search" />
            <Shortcut keys={["⌘", "K"]} label="Command palette" />
            <Shortcut keys={["Esc"]} label="Blur search / close modals" />
            <Shortcut keys={["?"]} label="Show this help" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-mono text-white/70"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
