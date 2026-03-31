import type { TabKey } from "./artistPageTypes";

interface ArtistTabsNavProps {
  tabs: { key: TabKey; label: string }[];
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}

export function ArtistTabsNav({ tabs, activeTab, onChange }: ArtistTabsNavProps) {
  return (
    <div className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10 px-4 md:px-8">
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        <div className="flex gap-1 -mb-px min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className={`px-3 md:px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-primary text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
