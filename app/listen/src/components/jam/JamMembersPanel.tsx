import type { TFunction } from "i18next";

import { JamAvatarBubble } from "@/components/jam/JamAvatarBubble";
import type { JamRoom, JamTrackRequest } from "@/pages/jam-reducer";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { displayName } from "@/pages/jam-session-utils";

export interface JamMembersPanelProps {
  t: TFunction;
  room: JamRoom;
  pendingRequests: JamTrackRequest[];
  canManageQueue: boolean;
  handleResolveRequest: (requestId: string, approve: boolean) => void;
}

export function JamMembersPanel({
  t,
  room,
  pendingRequests,
  canManageQueue,
  handleResolveRequest,
}: JamMembersPanelProps) {
  return (
    <section className="jam-members-panel min-h-0 min-w-0 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        {t("jam.room.members")}
      </h2>
      {pendingRequests.length > 0 ? (
        <div className="jam-request-panel mt-4 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="jam-warning-text text-sm font-medium">
              {t("jam.room.pendingRequests")}
            </div>
            <div className="jam-request-count rounded-full px-2 py-0.5 text-xs">
              {pendingRequests.length}
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="jam-queue-item flex items-center gap-2 rounded-lg px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-text-primary">
                    {request.track.title}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {request.track.artist}
                    {request.requester_name
                      ? ` · ${request.requester_name}`
                      : ""}
                  </div>
                </div>
                {canManageQueue ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleResolveRequest(request.id, true)}
                      className="jam-request-action rounded-md px-2 py-1 text-xs font-medium"
                    >
                      {t("jam.room.approveRequest")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveRequest(request.id, false)}
                      className="jam-secondary-action rounded-md px-2 py-1 text-xs text-text-muted transition-colors"
                    >
                      {t("jam.room.rejectRequest")}
                    </button>
                  </>
                ) : (
                  <span className="jam-warning-text text-xs">
                    {t("jam.room.waitingForHost")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {room.members.map((member) => (
          <UserProfileLink
            key={`${member.room_id}-${member.user_id}`}
            username={member.username}
            hoverClassName="block"
            className="jam-card-interactive flex items-center justify-between gap-3 rounded-lg px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <JamAvatarBubble
                name={displayName(member)}
                avatar={member.avatar}
                userId={member.user_id}
                size="sm"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {displayName(member)}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {member.username
                    ? `@${member.username}`
                    : t("jam.room.profile")}{" "}
                  · {member.role}
                </div>
              </div>
            </div>
            <div className="jam-chip rounded-full px-2.5 py-1 text-xs text-text-muted">
              {member.user_id === room.host_user_id
                ? t("jam.room.roles.host")
                : t("jam.room.roles.collab")}
            </div>
          </UserProfileLink>
        ))}
      </div>
    </section>
  );
}
