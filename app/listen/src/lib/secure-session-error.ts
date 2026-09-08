export function renderSecureSessionError(root: HTMLElement): void {
  root.innerHTML = `
    <main class="listen-secure-session-error">
      <section class="listen-secure-session-error__content">
        <h1>Unable to unlock this session</h1>
        <p class="listen-secure-session-error__message">Crate could not access the device secure storage. Restart the app and try again.</p>
        <button class="listen-secure-session-error__retry" type="button">Retry</button>
      </section>
    </main>`;

  root
    .querySelector<HTMLButtonElement>(".listen-secure-session-error__retry")
    ?.addEventListener("click", () => window.location.reload());
}
