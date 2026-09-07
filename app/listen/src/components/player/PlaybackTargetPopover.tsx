import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Check, CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { cn } from "@crate/ui/lib/cn";

import type {
  PlaybackTarget,
  PlaybackTargetGroup,
} from "@/lib/playback-targets";

import { PlaybackTargetIcon } from "./PlaybackTargetIcon";

export function PlaybackTargetPopover({
  popoverRef,
  position,
  loading,
  groups,
  onTarget,
}: {
  popoverRef: RefObject<HTMLDivElement | null>;
  position: { right: number; bottom: number };
  loading: boolean;
  groups: PlaybackTargetGroup[];
  onTarget: (target: PlaybackTarget) => void;
}) {
  const { t } = useTranslation();

  return (
    <AppPopover
      ref={popoverRef}
      role="menu"
      aria-label={t("player.output.targets")}
      className="fixed z-[1600] w-[min(calc(100vw-1rem),340px)] rounded-[12px] p-2"
      style={{ right: position.right, bottom: position.bottom }}
    >
      <div className="px-2 pb-2 pt-1">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          {t("player.output.label")}
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-text-muted">
          <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
          {t("player.output.loading")}
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          {groups.map((group) => (
            <PlaybackTargetGroupView
              key={group.providerId}
              group={group}
              onTarget={onTarget}
            />
          ))}
          {groups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-text-muted">
              {t("player.output.empty")}
            </div>
          ) : null}
        </div>
      )}
    </AppPopover>
  );
}

function PlaybackTargetGroupView({
  group,
  onTarget,
}: {
  group: PlaybackTargetGroup;
  onTarget: (target: PlaybackTarget) => void;
}) {
  return (
    <div className="pb-2 last:pb-0">
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-[0.14em] text-text-subtle">
        {group.label}
      </div>
      {group.targets.map((target) => (
        <PlaybackTargetRow
          key={target.id}
          target={target}
          onSelect={onTarget}
        />
      ))}
      {group.error ? (
        <div className="px-3 py-2 text-xs text-text-muted">{group.error}</div>
      ) : null}
    </div>
  );
}

function PlaybackTargetRow({
  target,
  onSelect,
}: {
  target: PlaybackTarget;
  onSelect: (target: PlaybackTarget) => void;
}) {
  const { t } = useTranslation();
  const badgeText = target.active
    ? t("player.output.badge.active")
    : !target.available
      ? t("player.output.badge.unavailable")
      : target.kind === "system-route"
        ? t("player.output.badge.system")
        : t("player.output.badge.ready");

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={target.active}
      aria-disabled={!target.available}
      onClick={() => onSelect(target)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        target.available
          ? "text-text-primary hover:bg-surface-control"
          : "text-text-subtle hover:bg-surface-control",
      )}
    >
      <span
        className={cn(
          "mt-0.5 rounded-lg border p-1.5",
          target.active
            ? "border-border-interactive bg-surface-control text-accent-action"
            : "border-border-quiet bg-surface-control text-text-muted",
        )}
      >
        <PlaybackTargetIcon target={target} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{target.name}</span>
          {target.active ? (
            <Check size={13} className="shrink-0 text-accent-action" />
          ) : null}
        </span>
        {target.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {target.subtitle}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
          target.active
            ? "border-border-interactive bg-surface-control text-accent-action"
            : target.available
              ? "border-border-quiet bg-surface-control text-text-secondary"
              : "border-border-quiet bg-surface-canvas text-text-subtle",
        )}
      >
        {badgeText}
      </span>
    </button>
  );
}
