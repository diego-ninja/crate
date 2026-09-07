import type { TFunction } from "i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { JamAvatarBubble } from "@/components/jam/JamAvatarBubble";
import type { AuthUser } from "@/contexts/auth-context";
import type { JamRoom } from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";
import { eventActivityText, resolveJamActor } from "@/pages/jam-session-utils";
import { ListMusic } from "@crate/ui/icons";

export interface JamActivityPanelProps {
  t: TFunction;
  room: JamRoom;
  user: AuthUser | null;
}

export function JamActivityPanel({ t, room, user }: JamActivityPanelProps) {
  return (
    <section className="jam-activity-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.room.recentActivity")}
      </h2>
      <div className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1">
        {[...room.events]
          .reverse()
          .slice(0, 20)
          .map((event) => {
            const actor = resolveJamActor(event, room.members, user);
            const payload = (event.payload_json || {}) as Record<
              string,
              unknown
            >;
            const track = payloadToTrack(
              payload.track as Record<string, unknown> | undefined,
            );
            return (
              <div
                key={event.id}
                className="jam-activity-card rounded-xl px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <JamAvatarBubble
                    name={actor.name}
                    avatar={actor.avatar}
                    userId={actor.user_id}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {eventActivityText(event, actor.name, t)}
                      </div>
                      <div className="shrink-0 text-xs text-text-muted">
                        {new Date(event.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    {track ? (
                      <div className="jam-dark-surface mt-2 flex items-center gap-2 rounded-xl p-2">
                        {track.albumCover ? (
                          <CrateImage
                            src={track.albumCover}
                            alt=""
                            className=" size-9 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="jam-artwork-placeholder flex size-9 items-center justify-center rounded-lg">
                            <ListMusic size={14} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-text-primary">
                            {track.title}
                          </div>
                          <div className="truncate text-xs text-text-muted">
                            {track.artist}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        {room.events.length === 0 ? (
          <p className="text-sm text-text-muted">{t("jam.room.noEvents")}</p>
        ) : null}
      </div>
    </section>
  );
}
