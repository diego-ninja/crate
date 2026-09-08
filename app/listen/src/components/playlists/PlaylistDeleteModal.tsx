import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { Loader2 } from "@crate/ui/icons";
import type { TFunction } from "i18next";

export function PlaylistDeleteModal({
  deleting,
  name,
  onClose,
  onDelete,
  open,
  t,
}: {
  deleting: boolean;
  name: string;
  onClose: () => void;
  onDelete: () => void;
  open: boolean;
  t: TFunction;
}) {
  return (
    <AppModal
      open={open}
      onClose={() => !deleting && onClose()}
      maxWidthClassName="sm:max-w-md"
    >
      <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("playlist.delete.title")}
          </h2>
          <p className="text-xs text-text-muted">
            {t("playlist.delete.subtitle")}
          </p>
        </div>
        <ModalCloseButton onClick={onClose} disabled={deleting} />
      </ModalHeader>
      <ModalBody className="p-5 ">
        <p className="text-sm text-text-muted">
          {t("playlist.delete.confirmPrefix")}{" "}
          <span className="font-medium text-text-primary">{name}</span>{" "}
          {t("playlist.delete.confirmSuffix")}
        </p>
      </ModalBody>
      <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
        <button
          type="button"
          className="rounded-lg px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
          onClick={onClose}
          disabled={deleting}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-state-danger px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-state-danger/90 disabled:opacity-50"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {t("playlist.actions.deletePlaylist")}
        </button>
      </ModalFooter>
    </AppModal>
  );
}
