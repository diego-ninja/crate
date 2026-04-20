import { useState, useCallback, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sidebar } from "./Sidebar";
import { SearchBar } from "./SearchBar";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { useKeyboard } from "@/hooks/use-keyboard";
import { useNotifications } from "@/hooks/use-notifications";
import { VisuallyHidden } from "radix-ui";

export function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const location = useLocation();

  return (
    <div className="flex min-h-screen [--sidebar-w:0px] md:[--sidebar-w:220px]">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 bg-card border-b border-border px-4 py-3 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
        </Button>
        <span className="text-lg font-bold text-foreground">
          <span className="text-primary">&#9835;</span> Crate
        </span>
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[220px]" showCloseButton={false}>
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 md:ml-[220px] overflow-x-hidden">
        <div className="p-4 pt-16 md:p-8 md:pt-8">
          <div className="flex items-center gap-3 mb-6 max-w-[1100px] relative z-[1100]">
            <div className="flex-1">
              <SearchBar inputRef={searchInputRef} />
            </div>
            <NotificationBell />
          </div>
          <div key={location.pathname} className="animate-page-in max-w-[1100px]">
            <Outlet />
          </div>
        </div>
      </main>
      <CommandPalette />

      {/* Keyboard shortcuts help */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>Navigate quickly with your keyboard.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <Shortcut keys={["/"]} label="Focus search" />
            <Shortcut keys={["\u2318", "K"]} label="Command palette" />
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
        {keys.map((k) => (
          <kbd
            key={k}
            className="px-2 py-0.5 rounded bg-secondary text-xs font-mono border border-border"
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}
