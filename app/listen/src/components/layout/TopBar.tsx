import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";

export function TopBar() {
  const navigate = useNavigate();

  return (
    <div className="flex h-16 w-full items-center gap-4 px-4 pointer-events-none">
      <div className="hidden items-center gap-2 flex-shrink-0 pointer-events-auto md:flex">
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Go back"
          title="Go back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => navigate(1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Go forward"
          title="Go forward"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="hidden md:block flex-1" />

      <TopBarSearch />
      <TopBarUserMenu />
    </div>
  );
}
