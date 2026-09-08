export const SIDEBAR_KEY = "listen-sidebar-expanded";
export const SIDEBAR_EVENT = "listen-sidebar-changed";

export function getStoredExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}
