import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";

import { SidebarBrand } from "./SidebarBrand";
import { SidebarNavigation } from "./SidebarNavigation";
import { SIDEBAR_EVENT, SIDEBAR_KEY, getStoredExpanded } from "./sidebar-model";

export function Sidebar() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const navigate = useNavigate();
  const { isPlaying, analyserVersion } = usePlayerState();
  const { playSource, currentTrack } = usePlayerActions();
  const discoveryRadioActive =
    isPlaying && playSource?.radio?.seedType === "discovery";
  const { frequenciesDb } = useAudioVisualizer(
    discoveryRadioActive,
    `sidebar:${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
  );
  const discoveryGlowStrength = useMemo(() => {
    if (!discoveryRadioActive) return 0;
    if (!frequenciesDb.length) return 0.42;
    const bins = frequenciesDb.slice(2, 28);
    if (!bins.length) return 0.42;
    const energy =
      bins.reduce((sum, db) => {
        const normalized = Math.max(0, Math.min(1, (db + 88) / 60));
        return sum + normalized * normalized;
      }, 0) / bins.length;
    return Math.min(1, Math.sqrt(energy));
  }, [discoveryRadioActive, frequenciesDb]);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENT, { detail: { expanded: next } }),
    );
  }

  const width = expanded ? "w-52" : "w-14";

  return (
    <aside
      className={`z-app-sidebar fixed top-0 left-0 bottom-0 ${width} flex flex-col border-r border-border-quiet bg-surface-canvas transition-all duration-200`}
    >
      <SidebarBrand
        discoveryGlowStrength={discoveryGlowStrength}
        discoveryRadioActive={discoveryRadioActive}
        expanded={expanded}
        onCollapse={toggleExpanded}
        onExpand={() => {
          toggleExpanded();
          navigate("/");
        }}
        collapseLabel={t("nav.sidebar.collapse")}
        expandLabel={t("nav.sidebar.expand")}
      />
      <SidebarNavigation
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
      />
    </aside>
  );
}
