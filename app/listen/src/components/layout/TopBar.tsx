import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";

export function TopBar() {
  const navigate = useNavigate();

  return (
    <div className="flex h-16 w-full items-center gap-2 px-3 pointer-events-none sm:gap-4 sm:px-4">
      <div className="flex flex-shrink-0 items-center gap-2 pointer-events-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/60 transition-colors hover:bg-black/50 hover:text-white md:h-9 md:w-9"
          aria-label="Go back"
          title="Go back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => navigate(1)}
          className="hidden h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/60 transition-colors hover:bg-black/50 hover:text-white md:flex"
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
