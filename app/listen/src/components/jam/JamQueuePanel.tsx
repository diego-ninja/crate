import type { JamQueuePanelProps } from "./JamQueueSections";
import { JamQueueList } from "./JamQueueListSections";
import { JamQueueToolbar } from "./JamQueueToolbarSections";

export function JamQueuePanel(props: JamQueuePanelProps) {
  return (
    <section className="jam-queue-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <JamQueueToolbar {...props} />
      <JamQueueList {...props} />
    </section>
  );
}
