import { Gapless5 } from "@/lib/gapless5/gapless5";
import { recordDevLog, redactUrl } from "@/lib/dev-logs";

interface GaplessPlaylistInternal {
  shuffledIndices: number[];
  sources: unknown[];
}

type GaplessInternal = Gapless5 & { playlist?: GaplessPlaylistInternal };

function getPlaylistInternal(
  player: Gapless5 | null,
): GaplessPlaylistInternal | null {
  return (player as GaplessInternal | null)?.playlist ?? null;
}

function normalizeShuffledIndices(player: Gapless5 | null): void {
  const playlist = getPlaylistInternal(player);
  if (!playlist) return;
  playlist.shuffledIndices = playlist.sources.map((_, i) => i);
}

export function loadQueue(
  player: Gapless5 | null,
  urls: string[],
  startIndex = 0,
  options: { restartIfSameIndex?: boolean } = {},
  onTrackStateReset: () => void,
): void {
  if (!player) return;
  recordDevLog(
    "gapless",
    "load queue",
    {
      count: urls.length,
      startIndex,
      firstUrl: urls[0] ? redactUrl(urls[0]) : null,
      restartIfSameIndex: options.restartIfSameIndex === true,
    },
    "debug",
  );

  const currentUrls = player.getTracks();
  const same =
    urls.length === currentUrls.length &&
    urls.every((url, i) => url === currentUrls[i]);
  if (same) {
    if (urls.length > 0 && player.getIndex() !== startIndex) {
      onTrackStateReset();
      player.gotoTrack(startIndex);
    } else if (urls.length > 0 && options.restartIfSameIndex) {
      onTrackStateReset();
      player.gotoTrack(startIndex, true);
    }
    return;
  }

  onTrackStateReset();
  player.removeAllTracks();
  for (const url of urls) {
    player.addTrack(url);
  }
  normalizeShuffledIndices(player);

  if (urls.length > 0) {
    player.gotoTrack(startIndex);
  }
}

export function addTrack(player: Gapless5 | null, url: string): void {
  player?.addTrack(url);
  normalizeShuffledIndices(player);
}

export function insertTrack(
  player: Gapless5 | null,
  index: number,
  url: string,
): void {
  player?.insertTrack(index, url);
  normalizeShuffledIndices(player);
}

export function removeTrack(
  player: Gapless5 | null,
  indexOrUrl: number | string,
): void {
  player?.removeTrack(indexOrUrl);
  normalizeShuffledIndices(player);
}

export function replaceTrack(
  player: Gapless5 | null,
  index: number,
  url: string,
): void {
  player?.replaceTrack(index, url);
}
