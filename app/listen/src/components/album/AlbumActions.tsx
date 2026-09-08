import type {
  AlbumActionData,
  AlbumActionHandlers,
  AlbumActionMenu,
  AlbumActionState,
} from "@/components/album/album-action-types";
import { AlbumActionNotices } from "@/components/album/AlbumActionNotices";
import { AlbumPrimaryActions } from "@/components/album/AlbumPrimaryActions";
import { AlbumSecondaryActions } from "@/components/album/AlbumSecondaryActions";

export function AlbumActions({
  data,
  coverUrl,
  displayName,
  globalAlbumUid,
  state,
  menu,
  actions,
  t,
}: AlbumActionData & {
  state: AlbumActionState;
  menu: AlbumActionMenu;
  actions: AlbumActionHandlers;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <div
        data-testid="album-action-row"
        className="relative z-10 -mt-[var(--album-mobile-action-overlap)] p-4 pb-4 pt-0 sm:mt-0 sm:px-0"
      >
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
          <AlbumPrimaryActions
            playerTracksAvailable={state.playerTracksAvailable}
            primaryRef={menu.primaryRef}
            onPlay={actions.onPlay}
            onShuffle={actions.onShuffle}
            t={t}
          />
          <AlbumSecondaryActions
            data={data}
            coverUrl={coverUrl}
            displayName={displayName}
            globalAlbumUid={globalAlbumUid}
            state={state}
            menu={menu}
            actions={actions}
            t={t}
          />
        </div>
      </div>
      <AlbumActionNotices
        data={data}
        globalAlbumUid={globalAlbumUid}
        state={state}
        t={t}
      />
    </>
  );
}
