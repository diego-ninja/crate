import { useState } from "react";

import { UpcomingEventRow } from "@/components/upcoming/UpcomingEventRow";
import { UpcomingShowCard } from "@/components/upcoming/UpcomingShowCard";
import {
  artistShowToUpcomingItem,
  formatMonthLabel,
  groupByMonth,
  itemKey,
  type ArtistShowEvent,
  type UpcomingItem,
} from "@/components/upcoming/upcoming-model";

export {
  artistShowToUpcomingItem,
  groupByMonth,
  itemKey,
  type ArtistShowEvent,
  type UpcomingItem,
  UpcomingEventRow,
  UpcomingShowCard,
};

export function UpcomingMonthGroup({
  month,
  items,
  expandedId,
  onToggleExpand,
}: {
  month: string;
  items: UpcomingItem[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
}) {
  const [attendanceOverrides, setAttendanceOverrides] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      <div className="border-b border-white/5 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
        {formatMonthLabel(month)}
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const key = itemKey(item, index);
          const itemWithOverrides = attendanceOverrides[key] == null
            ? item
            : { ...item, user_attending: attendanceOverrides[key] };

          if (item.type === "show") {
            return (
              <UpcomingShowCard
                key={key}
                item={itemWithOverrides}
                expanded={expandedId === key}
                onToggle={() => onToggleExpand(expandedId === key ? null : key)}
                onAttendanceChange={(attending) => {
                  setAttendanceOverrides((current) => ({ ...current, [key]: attending }));
                }}
              />
            );
          }

          return (
            <UpcomingEventRow
              key={key}
              item={itemWithOverrides}
              onAttendanceChange={(attending) => {
                setAttendanceOverrides((current) => ({ ...current, [key]: attending }));
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
