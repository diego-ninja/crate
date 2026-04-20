import { useCallback } from "react";
import { flushSync } from "react-dom";
import { NavLink, useNavigate, type NavLinkProps } from "react-router";

export function VtNavLink({ onClick, to, ...props }: NavLinkProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();

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
