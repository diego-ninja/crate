import { useEffect, useLayoutEffect, type RefObject } from "react";

const INFO_ACTION_GAP_PX = 20;

export function useAlbumHeroMeasurement({
  albumHeroInfoRef,
  albumPrimaryActionsRef,
  isDesktop,
  mobileHeroInfoOffset,
  setMobileHeroInfoOffset,
}: {
  albumHeroInfoRef: RefObject<HTMLDivElement | null>;
  albumPrimaryActionsRef: RefObject<HTMLDivElement | null>;
  isDesktop: boolean;
  mobileHeroInfoOffset: number;
  setMobileHeroInfoOffset: (
    value: number | ((current: number) => number),
  ) => void;
}) {
  useLayoutEffect(() => {
    if (isDesktop) {
      setMobileHeroInfoOffset((current) => (current === 0 ? current : 0));
      return;
    }

    const info = albumHeroInfoRef.current;
    const actions = albumPrimaryActionsRef.current;
    if (!info || !actions) return;

    let frame = 0;
    const applyMeasurement = () => {
      const infoRect = info.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      if (
        (infoRect.width === 0 && infoRect.height === 0) ||
        (actionsRect.width === 0 && actionsRect.height === 0)
      ) {
        return;
      }

      const currentGap = actionsRect.top - infoRect.bottom;
      const nextOffset = Math.round(
        mobileHeroInfoOffset + currentGap - INFO_ACTION_GAP_PX,
      );

      setMobileHeroInfoOffset((current) =>
        Math.abs(current - nextOffset) > 1 ? nextOffset : current,
      );
    };
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyMeasurement);
    };

    applyMeasurement();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(info);
    resizeObserver?.observe(actions);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    albumHeroInfoRef,
    albumPrimaryActionsRef,
    isDesktop,
    mobileHeroInfoOffset,
    setMobileHeroInfoOffset,
  ]);
}

export function useAlbumSharedTrackScroll({
  albumId,
  hasTracks,
  sharedTrackUid,
}: {
  albumId?: number | null;
  hasTracks: boolean;
  sharedTrackUid: string | null;
}) {
  useEffect(() => {
    if (!sharedTrackUid || !hasTracks) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`track-${sharedTrackUid}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [albumId, hasTracks, sharedTrackUid]);
}
