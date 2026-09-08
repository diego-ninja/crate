import { Loader2 } from "@crate/ui/icons";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

import type { LibraryContribution } from "./library-model";

export function LibraryBandcampWithdrawModal({
  target,
  withdrawing,
  title,
  description,
  keepLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  target: LibraryContribution | null;
  withdrawing: boolean;
  title: string;
  description: string;
  keepLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AppModal
      open={Boolean(target)}
      onClose={() => {
        if (!withdrawing) onClose();
      }}
    >
      <ModalHeader>
        <h2 className="text-lg font-black text-text-primary">{title}</h2>
        <ModalCloseButton disabled={withdrawing} onClick={onClose} />
      </ModalHeader>
      <ModalBody>
        <p className="text-sm text-text-muted">{description}</p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          disabled={withdrawing}
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-full border border-border-quiet px-4 text-sm font-bold text-text-muted disabled:opacity-50"
        >
          {keepLabel}
        </button>
        <button
          type="button"
          disabled={withdrawing}
          onClick={onConfirm}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-state-danger px-4 text-sm font-black text-state-danger-foreground disabled:opacity-50"
        >
          {withdrawing ? <Loader2 size={16} className="animate-spin" /> : null}
          {confirmLabel}
        </button>
      </ModalFooter>
    </AppModal>
  );
}
