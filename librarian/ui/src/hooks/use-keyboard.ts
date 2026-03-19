import { useEffect } from "react";

interface KeyboardShortcuts {
  onFocusSearch: () => void;
  onBlurSearch: () => void;
  onShowHelp: () => void;
}

export function useKeyboard({ onFocusSearch, onBlurSearch, onShowHelp }: KeyboardShortcuts) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Escape") {
        onBlurSearch();
        return;
      }

      if (isInput) return;

      if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        onShowHelp();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onFocusSearch, onBlurSearch, onShowHelp]);
}
