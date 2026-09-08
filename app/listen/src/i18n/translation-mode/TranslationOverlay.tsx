import { Loader2, X } from "@crate/ui/icons/translation";

import { Button } from "@crate/ui/shadcn/button";
import { useTranslationOverlay } from "@/i18n/translation-mode/useTranslationOverlay";

export function TranslationOverlay() {
  const {
    active,
    available,
    hoveredMarker,
    hoveredRect,
    selectedTarget,
    draftValue,
    saveStatus,
    setDraftValue,
    closeEditor,
    saveSelected,
  } = useTranslationOverlay();

  if (!available || !active) {
    return null;
  }

  return (
    <div
      data-translation-overlay
      className="pointer-events-none fixed inset-0 z-[9999]"
    >
      <div className="pointer-events-none absolute inset-0">
        {hoveredRect ? (
          <div
            className="absolute rounded-[4px] border border-accent-action/40 bg-accent-action/[0.06] shadow-accent-action-medium"
            style={{
              height: hoveredRect.height,
              transform: `translate(${hoveredRect.left}px, ${hoveredRect.top}px)`,
              width: hoveredRect.width,
            }}
          />
        ) : null}
        {hoveredMarker ? (
          <div className="absolute right-4 bottom-4 rounded-md border border-accent-action/25 bg-surface-canvas/55 px-3 py-2 text-xs text-text-accent shadow-translation-marker backdrop-blur-xl">
            <div className="font-semibold">Translation Mode</div>
            <code className="mt-1 block font-mono text-xs text-text-accent/85">
              {hoveredMarker.key}
            </code>
          </div>
        ) : (
          <div className="absolute right-4 bottom-4 rounded-md border border-border-quiet bg-surface-canvas/45 px-3 py-2 text-xs text-text-primary/65 shadow-translation-marker-muted backdrop-blur-xl">
            Translation Mode
          </div>
        )}
      </div>

      {selectedTarget ? (
        <dialog
          open
          aria-label="Edit translation"
          className="pointer-events-auto absolute right-4 bottom-20 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-accent-action/20 bg-surface-canvas/82 text-text-primary shadow-translation-editor backdrop-blur-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border-quiet px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Edit translation</div>
              <code className="mt-1 block truncate font-mono text-xs text-text-accent/85">
                {selectedTarget.key}
              </code>
            </div>
            <button
              type="button"
              aria-label="Close translation editor"
              onClick={closeEditor}
              className="text-text-primary/45 transition-[color,filter] hover:text-text-accent hover:drop-shadow-accent-action"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3 p-4 ">
            <Field label="Locale" value={selectedTarget.locale} />
            <Field label="English source" value={selectedTarget.sourceValue} />
            <Field label="Quality status" value="Not checked locally" />

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-text-primary/35">
                Current value
              </span>
              <textarea
                aria-label="Current value"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                className="min-h-24 w-full resize-y rounded-md border border-border-quiet bg-surface-canvas/24 px-3 py-2 text-base text-text-primary outline-none transition-colors placeholder:text-text-primary/28 focus:border-accent-action/45"
              />
            </label>

            {saveStatus === "error" ? (
              <p className="text-xs text-state-danger-text">
                Could not save the local catalog.
              </p>
            ) : null}
            {saveStatus === "saved" ? (
              <p className="text-xs text-state-success-text">
                Saved to workspace JSON.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="rounded-lg"
                onClick={() => void saveSelected()}
                disabled={saveStatus === "saving"}
              >
                {saveStatus === "saving" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : null}
                Save translation
              </Button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-text-primary/35">
        {label}
      </div>
      <div className="rounded-md border border-text-primary/8 bg-text-primary/[0.04] px-3 py-2 text-sm text-text-primary/80">
        {value || "-"}
      </div>
    </div>
  );
}
