import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { ActionIconButton, ActionIconLink } from "@crate-ui/primitives/ActionIconButton";

export function UpcomingActionButton({
  title,
  onClick,
  disabled = false,
  active = false,
  children,
}: {
  title: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <ActionIconButton
      onClick={onClick}
      disabled={disabled}
      active={active}
      title={title}
    >
      {children}
    </ActionIconButton>
  );
}

export function UpcomingActionLink({
  title,
  href,
  disabled = false,
  active = false,
  onClick,
  children,
}: {
  title: string;
  href?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <ActionIconLink
      href={href || "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      active={active}
      disabled={disabled}
      title={title}
    >
      {children}
    </ActionIconLink>
  );
}
