export const TAURI_AUTH_DIAGNOSTIC_EVENT = "crate:tauri-auth-diagnostic";
export const TAURI_AUTH_DIAGNOSTIC_KEY = "crate-tauri-auth-diagnostic:v1";

export interface TauriAuthDiagnostic {
  status: string;
  detail?: string;
  at: string;
}

export function getTauriAuthDiagnostic(): TauriAuthDiagnostic | null {
  try {
    const raw = localStorage.getItem(TAURI_AUTH_DIAGNOSTIC_KEY);
    return raw ? (JSON.parse(raw) as TauriAuthDiagnostic) : null;
  } catch {
    return null;
  }
}

export function recordTauriAuthDiagnostic(
  status: string,
  detail?: string,
): void {
  const diagnostic: TauriAuthDiagnostic = {
    status,
    detail,
    at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(TAURI_AUTH_DIAGNOSTIC_KEY, JSON.stringify(diagnostic));
  } catch {
    // Ignore persistence failures; the in-memory event still helps dev QA.
  }

  try {
    window.dispatchEvent(
      new CustomEvent<TauriAuthDiagnostic>(TAURI_AUTH_DIAGNOSTIC_EVENT, {
        detail: diagnostic,
      }),
    );
  } catch {
    // ignore
  }
}
