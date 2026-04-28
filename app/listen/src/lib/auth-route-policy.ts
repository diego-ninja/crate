const PUBLIC_AUTH_BOOTSTRAP_PATHS = new Set([
  "/login",
  "/register",
  "/server-setup",
  "/auth/callback",
]);

export function shouldRedirectToLoginOnUnauthorized(pathname: string): boolean {
  return !PUBLIC_AUTH_BOOTSTRAP_PATHS.has(pathname);
}

export function redirectToLoginOnUnauthorized(
  pathname: string,
  redirect: (path: string) => void,
) {
  if (shouldRedirectToLoginOnUnauthorized(pathname)) {
    redirect("/login");
  }
}
