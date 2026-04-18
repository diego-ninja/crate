import { useCallback } from "react";
import { flushSync } from "react-dom";
import { NavLink, useNavigate, type NavLinkProps } from "react-router";

/**
 * NavLink that triggers the View Transitions API on click.
 * Drop-in replacement for <NavLink> — same props, same render.
 * Falls back to instant navigation on unsupported browsers.
 */
export function VtNavLink({ onClick, to, ...props }: NavLinkProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();

      if (!document.startViewTransition) {
        navigate(to);
        return;
      }
      document.startViewTransition(() => {
        flushSync(() => {
          navigate(to);
        });
      });
    },
    [navigate, onClick, to],
  );

  return <NavLink to={to} onClick={handleClick} {...props} />;
}
