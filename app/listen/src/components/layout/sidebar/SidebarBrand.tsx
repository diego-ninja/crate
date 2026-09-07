import { CRATE_ICON_SIZE, PanelLeftClose } from "@crate/ui/icons";

interface SidebarBrandProps {
  discoveryGlowStrength: number;
  discoveryRadioActive: boolean;
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  collapseLabel: string;
  expandLabel: string;
}

export function SidebarBrand({
  discoveryGlowStrength,
  discoveryRadioActive,
  expanded,
  onCollapse,
  onExpand,
  collapseLabel,
  expandLabel,
}: SidebarBrandProps) {
  return (
    <div
      className={`flex items-center ${
        expanded ? "gap-3 px-4 py-5" : "justify-center py-5"
      }`}
    >
      {expanded ? (
        <>
          <div className="relative shrink-0">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-10px] rounded-[22px] bg-[radial-gradient(circle,var(--accent-action-glow-strong)_0%,var(--accent-action-glow-medium)_32%,var(--accent-action-glow-soft)_54%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
              style={{
                opacity: discoveryRadioActive
                  ? 0.22 + discoveryGlowStrength * 0.68
                  : 0,
                filter: `blur(${12 + discoveryGlowStrength * 8}px)`,
              }}
            />
            <img
              src="/icons/logo.svg"
              alt="Crate"
              className="relative z-10 size-8 shrink-0 transition-[filter] duration-300"
              style={{
                filter: discoveryRadioActive
                  ? `drop-shadow(0 0 ${
                      10 + discoveryGlowStrength * 16
                    }px color-mix(in srgb, var(--accent-action) ${Math.round(
                      (0.18 + discoveryGlowStrength * 0.24) * 100,
                    )}%, transparent))`
                  : "none",
              }}
            />
          </div>
          <span
            className={`flex-1 text-sm font-bold transition-[color,text-shadow] duration-300 ${
              discoveryRadioActive ? "text-accent-action" : "text-text-primary"
            }`}
            style={{
              textShadow: discoveryRadioActive
                ? `0 0 ${
                    8 + discoveryGlowStrength * 10
                  }px color-mix(in srgb, var(--accent-action) ${Math.round(
                    (0.12 + discoveryGlowStrength * 0.18) * 100,
                  )}%, transparent)`
                : "none",
            }}
          >
            Crate
          </span>
          <button
            onClick={onCollapse}
            aria-label={collapseLabel}
            className="text-text-subtle transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action"
          >
            <PanelLeftClose size={CRATE_ICON_SIZE.nav} />
          </button>
        </>
      ) : (
        <button
          onClick={onExpand}
          className="relative flex size-10 items-center justify-center transition-[filter,transform] hover:-translate-y-px hover:drop-shadow-accent-action"
          aria-label={expandLabel}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-6px] rounded-[18px] bg-[radial-gradient(circle,var(--accent-action-glow-strong)_0%,var(--accent-action-glow-medium)_40%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
            style={{
              opacity: discoveryRadioActive
                ? 0.2 + discoveryGlowStrength * 0.64
                : 0,
              filter: `blur(${10 + discoveryGlowStrength * 7}px)`,
            }}
          />
          <img
            src="/icons/logo.svg"
            alt="Crate"
            className="relative z-10 size-6 transition-[filter] duration-300"
            style={{
              filter: discoveryRadioActive
                ? `drop-shadow(0 0 ${
                    8 + discoveryGlowStrength * 14
                  }px color-mix(in srgb, var(--accent-action) ${Math.round(
                    (0.16 + discoveryGlowStrength * 0.22) * 100,
                  )}%, transparent))`
                : "none",
            }}
          />
        </button>
      )}
    </div>
  );
}
