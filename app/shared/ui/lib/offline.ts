export type OfflineItemState = "idle" | "queued" | "downloading" | "syncing" | "ready" | "error";

export function isOfflineBusy(state: OfflineItemState): boolean {
  return state === "queued" || state === "downloading" || state === "syncing";
}

export function getOfflineStateLabel(state: OfflineItemState): string | null {
  switch (state) {
    case "queued":
      return "Queued for offline";
    case "downloading":
      return "Downloading for offline";
    case "syncing":
      return "Syncing offline copy";
    case "ready":
      return "Available offline";
    case "error":
      return "Offline copy failed";
    default:
      return null;
  }
}

export function getOfflineActionLabel(state: OfflineItemState): string {
  switch (state) {
    case "ready":
      return "Remove offline copy";
    case "error":
      return "Retry offline copy";
    case "queued":
    case "downloading":
      return "Downloading...";
    case "syncing":
      return "Syncing...";
    default:
      return "Make available offline";
  }
}
