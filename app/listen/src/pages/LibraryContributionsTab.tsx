import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Plus, Trash2 } from "@crate/ui/icons";
import { toast } from "sonner";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { CrateImage } from "@/components/artwork/CrateImage";
import { useApi } from "@/hooks/use-api";
import { api, apiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
import { openExternalUrl } from "@/lib/external-links";
import { albumCoverApiUrl } from "@/lib/library-routes";

import { EmptyState, Spinner } from "./LibraryPrimitives";
import type {
  BandcampTaskResponse,
  ContributionsResponse,
  LibraryContribution,
} from "./library-model";

function exportContribution(contribution: LibraryContribution) {
  void openExternalUrl(
    apiAssetUrl(`/api/me/contributions/${contribution.id}/export`),
  );
}

function ContributionArtwork({
  contribution,
}: {
  contribution: LibraryContribution;
}) {
  return (
    <div className=" size-14 shrink-0 overflow-hidden rounded-xl border border-text-primary/8 bg-text-primary/6">
      {contribution.album_id ? (
        <CrateImage
          src={albumCoverApiUrl(
            {
              albumId: contribution.album_id,
              albumEntityUid: contribution.album_entity_uid,
              artistName: contribution.artist_name,
              albumName: contribution.album_name,
            },
            { size: 128 },
          )}
          alt=""
          loading="lazy"
          className=" size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-accent-action/70">
          {contribution.source === "bandcamp" ? (
            <BandcampLogo size={20} />
          ) : (
            <Plus size={20} />
          )}
        </div>
      )}
    </div>
  );
}

export function LibraryContributionsTab() {
  const { t } = useTranslation();
  const {
    data,
    loading,
    refetch: refetchContributions,
  } = useApi<ContributionsResponse>("/api/me/contributions");
  const [withdrawTarget, setWithdrawTarget] =
    useState<LibraryContribution | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  if (loading) return <Spinner />;

  const contributions = data?.items ?? [];

  async function withdrawContribution() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      const response = await api<BandcampTaskResponse>(
        `/api/me/contributions/${withdrawTarget.id}/withdraw`,
        "POST",
      );
      toast.success(
        t("library.contributions.toasts.removalQueued", {
          taskId: response.task_id,
        }),
      );
      setWithdrawTarget(null);
      refetchContributions();
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("library.contributions.toasts.removeFailed"),
      );
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[12px] border border-border-quiet bg-text-primary/[0.04] p-5">
        <h2 className="text-xl font-black text-text-primary">
          {t("library.contributions.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
          {t("library.contributions.description")}
        </p>
      </div>

      {!contributions.length ? (
        <EmptyState message={t("library.contributions.empty")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {contributions.map((contribution) => (
            <article
              key={contribution.id}
              className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-text-primary/[0.03] p-3"
            >
              <ContributionArtwork contribution={contribution} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black text-text-primary">
                  {contribution.album_name}
                </h3>
                <p className="truncate text-xs text-text-muted">
                  {contribution.artist_name}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-accent-action/80">
                  {contributionSourceLabel(contribution.source)}
                </p>
              </div>
              <button
                type="button"
                disabled={!contribution.album_id}
                onClick={() => exportContribution(contribution)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border-quiet px-3 text-xs font-bold text-text-muted disabled:opacity-40"
              >
                <Download size={14} />
                {t("common.export")}
              </button>
              <button
                type="button"
                onClick={() => setWithdrawTarget(contribution)}
                className="inline-flex min-h-10 items-center rounded-full border border-state-danger/20 px-3 text-xs font-bold text-state-danger"
              >
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      )}

      <AppModal
        open={Boolean(withdrawTarget)}
        onClose={() => {
          if (!withdrawing) setWithdrawTarget(null);
        }}
      >
        <ModalHeader>
          <h2 className="text-lg font-black text-text-primary">
            {t("library.contributions.withdraw.title")}
          </h2>
          <ModalCloseButton
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
          />
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-text-muted">
            {t("library.contributions.withdraw.description", {
              album: withdrawTarget?.album_name,
            })}
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => setWithdrawTarget(null)}
            className="inline-flex min-h-11 items-center rounded-full border border-border-quiet px-4 text-sm font-bold text-text-muted disabled:opacity-50"
          >
            {t("common.keepIt")}
          </button>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => void withdrawContribution()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-state-danger px-4 text-sm font-black text-state-danger-foreground disabled:opacity-50"
          >
            {withdrawing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : null}
            {t("library.contributions.withdraw.confirm")}
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}
