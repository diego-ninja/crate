import type { TFunction } from "i18next";
import { Copy, Loader2, UserMinus, Users } from "@crate/ui/icons";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import type { AuthUser } from "@/contexts/auth-context";
import type { PlaylistData, PlaylistMember } from "@/pages/playlist-types";

export function PlaylistCollaboratorsModal({
  creatingInvite,
  data,
  inviteLink,
  isOwner,
  members,
  onClose,
  onCopyInviteLink,
  onCreateInvite,
  onRemoveMember,
  open,
  removingMemberId,
  t,
  user,
}: {
  creatingInvite: boolean;
  data: PlaylistData;
  inviteLink: string | null;
  isOwner: boolean;
  members: PlaylistMember[];
  onClose: () => void;
  onCopyInviteLink: () => void;
  onCreateInvite: () => void;
  onRemoveMember: (memberUserId: number) => void;
  open: boolean;
  removingMemberId: number | null;
  t: TFunction;
  user: AuthUser | null;
}) {
  return (
    <AppModal open={open} onClose={onClose} maxWidthClassName="sm:max-w-lg">
      <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("playlist.collaborators.title")}
          </h2>
          <p className="text-xs text-text-muted">
            {data.is_collaborative
              ? t("playlist.collaborators.subtitle")
              : t("playlist.collaborators.notCollaborative")}
          </p>
        </div>
        <ModalCloseButton onClick={onClose} />
      </ModalHeader>
      <ModalBody className="space-y-5 p-5 ">
        {data.is_collaborative && isOwner ? (
          <div className="rounded-xl border border-accent-action/15 bg-accent-action/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t("playlist.collaborators.inviteTitle")}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t("playlist.collaborators.inviteSubtitle")}
                </div>
              </div>
              <button
                type="button"
                onClick={onCreateInvite}
                disabled={creatingInvite}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-60"
              >
                {creatingInvite ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Users size={15} />
                )}
                {t("playlist.collaborators.createInvite")}
              </button>
            </div>
            {inviteLink ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
                <div className="flex justify-center">
                  <QrCodeImage
                    value={inviteLink}
                    size={160}
                    className="rounded-xl border border-border-quiet bg-surface-canvas p-3"
                  />
                </div>
                <div className="space-y-3">
                  <div className="break-all border-l-2 border-border-quiet px-4 py-3 text-xs text-text-muted">
                    {inviteLink}
                  </div>
                  <button
                    type="button"
                    onClick={onCopyInviteLink}
                    className="inline-flex items-center gap-2 rounded-lg border border-text-primary/15 bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/10"
                  >
                    <Copy size={15} />
                    {t("playlist.collaborators.copyInvite")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3">
          {members.map((member) => {
            const label =
              member.display_name ||
              member.username ||
              `User ${member.user_id}`;
            const isCurrentUser = user?.id === member.user_id;
            return (
              <div
                key={`${member.playlist_id}-${member.user_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-quiet bg-text-primary/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  {member.username ? (
                    <UserProfileLink
                      username={member.username}
                      hoverClassName="block"
                      className="block truncate text-sm font-medium text-text-primary transition-colors hover:text-accent-action"
                    >
                      {label}
                    </UserProfileLink>
                  ) : (
                    <div className="truncate text-sm font-medium text-text-primary">
                      {label}
                    </div>
                  )}
                  <div className="truncate text-xs text-text-muted">
                    {member.username
                      ? `@${member.username}`
                      : t("playlist.collaborators.profile")}{" "}
                    · {member.role}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-full border border-border-quiet px-2.5 py-1 text-xs text-text-muted">
                    {member.role === "owner"
                      ? t("playlist.collaborators.owner")
                      : t("playlist.collaborators.collab")}
                  </div>
                  {isOwner && member.role !== "owner" && !isCurrentUser ? (
                    <button
                      type="button"
                      onClick={() => onRemoveMember(member.user_id)}
                      disabled={removingMemberId === member.user_id}
                      className="inline-flex items-center gap-1 rounded-full border border-state-danger/20 px-2.5 py-1 text-xs text-state-danger-text transition-colors hover:bg-state-danger/10 disabled:opacity-60"
                    >
                      {removingMemberId === member.user_id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <UserMinus size={12} />
                      )}
                      {t("common.remove")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </ModalBody>
    </AppModal>
  );
}
