import type { ComponentProps } from "react";

import { JamActivityPanel } from "@/components/jam/JamActivityPanel";
import { JamMembersPanel } from "@/components/jam/JamMembersPanel";
import { JamQueuePanel } from "@/components/jam/JamQueuePanel";
import { JamRoomHero } from "@/components/jam/JamRoomHero";
import { JamRoomModals } from "@/components/jam/JamRoomModals";

type JamRoomViewProps = {
  hero: ComponentProps<typeof JamRoomHero>;
  members: ComponentProps<typeof JamMembersPanel>;
  queue: ComponentProps<typeof JamQueuePanel>;
  activity: ComponentProps<typeof JamActivityPanel>;
  modals: ComponentProps<typeof JamRoomModals>;
};

export function JamRoomView({
  hero,
  members,
  queue,
  activity,
  modals,
}: JamRoomViewProps) {
  return (
    <div className="space-y-6">
      <JamRoomHero {...hero} />
      <div className="grid min-h-0 min-w-0 gap-6 xl:grid-cols-[0.85fr_1.1fr_1.1fr]">
        <JamMembersPanel {...members} />
        <JamQueuePanel {...queue} />
        <JamActivityPanel {...activity} />
      </div>
      <JamRoomModals {...modals} />
    </div>
  );
}
