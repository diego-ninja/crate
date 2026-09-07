import { Loader2, Trash2 } from "@crate/ui/icons";
import type { TFunction } from "i18next";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import type { JamRoom } from "@/pages/jam-reducer";

export interface JamDeleteRoomModalProps {
  t: TFunction;
  deleteTargetRoom: JamRoom | null;
  deletingRoomId: string | null;
  setDeleteTargetRoom: (value: JamRoom | null) => void;
  confirmDeleteRoom: () => void | Promise<void>;
}

export function JamDeleteRoomModal({
  t,
  deleteTargetRoom,
  deletingRoomId,
  setDeleteTargetRoom,
  confirmDeleteRoom,
}: JamDeleteRoomModalProps) {
  return (
    <AppModal
      open={deleteTargetRoom !== null}
      onClose={() => {
        if (!deletingRoomId) setDeleteTargetRoom(null);
      }}
      maxWidthClassName="sm:max-w-md"
    >
      <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.delete.modalTitle")}
          </h2>
          <p className="text-xs text-text-muted">
            {t("jam.delete.modalDescription")}
          </p>
        </div>
        <ModalCloseButton
          onClick={() => {
            if (!deletingRoomId) setDeleteTargetRoom(null);
          }}
        />
      </ModalHeader>
      <ModalBody className="p-5 ">
        <div className="space-y-4">
          <div className="jam-danger-panel rounded-lg px-4 py-3">
            <div className="text-sm font-medium text-text-primary">
              {deleteTargetRoom?.name || t("jam.delete.roomFallback")}
            </div>
            <div className="jam-danger-text mt-1 text-xs">
              {t("jam.delete.irreversible")}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTargetRoom(null)}
              disabled={Boolean(deletingRoomId)}
              className="jam-secondary-action rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteRoom()}
              disabled={Boolean(deletingRoomId)}
              className="jam-danger-control inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {deletingRoomId ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              {t("jam.delete.confirm")}
            </button>
          </div>
        </div>
      </ModalBody>
    </AppModal>
  );
}
