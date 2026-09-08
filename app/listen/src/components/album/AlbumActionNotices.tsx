import { RemoteImportAction } from "@/components/imports/RemoteImportAction";
import type {
  AlbumActionData,
  AlbumActionState,
} from "@/components/album/album-action-types";

export function AlbumActionNotices({
  data,
  globalAlbumUid,
  state,
  t,
}: Pick<AlbumActionData, "data" | "globalAlbumUid"> & {
  state: Pick<
    AlbumActionState,
    "remoteOnly" | "offlineStatusDetail" | "isPreRelease"
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      {state.remoteOnly && globalAlbumUid ? (
        <div className="px-4 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1480px]">
            <RemoteImportAction
              globalAlbumUid={globalAlbumUid}
              estimatedBytes={
                data.total_size_mb > 0 ? data.total_size_mb * 1_000_000 : null
              }
              sourceName={data.availability?.source_name}
            />
          </div>
        </div>
      ) : null}

      {state.offlineStatusDetail ? (
        <div className="px-4 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1480px]">
            <p className="text-xs text-text-muted">
              {state.offlineStatusDetail}
            </p>
          </div>
        </div>
      ) : null}

      {state.isPreRelease ? (
        <div className="px-4 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1480px] rounded-lg border border-accent-action/15 bg-accent-action/5 px-4 py-3 text-sm text-accent-action/90">
            {t("album.prereleaseNotice")}
          </div>
        </div>
      ) : null}
    </>
  );
}
