import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";

export function TopBar() {
  const navigate = useNavigate();

  return (
    <div className="flex h-16 w-full items-center gap-4 px-4 pointer-events-none">
      <div className="flex items-center gap-2 flex-shrink-0 pointer-events-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/60 transition-colors hover:bg-black/50 hover:text-white"
          aria-label="Go back"
          title="Go back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => navigate(1)}
          className="hidden md:flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/60 transition-colors hover:bg-black/50 hover:text-white"
          aria-label="Go forward"
          title="Go forward"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="hidden md:block flex-1" />

      <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-4 pointer-events-auto">
        <TopBarSearch />
        <TopBarUserMenu />
      </div>
    </div>
  );
}
