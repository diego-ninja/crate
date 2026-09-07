import { ChevronLeft, ChevronRight, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { TopBarUserMenu } from "@/components/layout/topbar/TopBarUserMenu";

interface TopBarProps {
  hideMobileActions?: boolean;
}

export function TopBar({ hideMobileActions = false }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backLabel = t("topbar.back");
  const forwardLabel = t("topbar.forward");

  return (
    <div className="flex h-16 w-full items-center gap-2 px-3 pointer-events-none sm:gap-4 sm:px-4">
      <div className="flex shrink-0 items-center gap-2 pointer-events-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex size-11 touch-manipulation items-center justify-center text-text-secondary transition-colors hover:text-text-primary md:size-10"
          aria-label={backLabel}
          title={backLabel}
        >
          <ChevronLeft
            size={CRATE_ICON_SIZE.navMobile}
            className="md:size-[21px]"
          />
        </button>
        <button
          onClick={() => navigate(1)}
          className="hidden size-10 items-center justify-center text-text-secondary transition-colors hover:text-text-primary md:flex"
          aria-label={forwardLabel}
          title={forwardLabel}
        >
          <ChevronRight size={CRATE_ICON_SIZE.nav} />
        </button>
      </div>

      <div className="hidden md:block flex-1" />

      {hideMobileActions ? null : (
        <div
          data-testid="topbar-actions"
          className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-4 pointer-events-auto"
        >
          <TopBarSearch />
          <TopBarUserMenu />
        </div>
      )}
    </div>
  );
}
