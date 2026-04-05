import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type ActionTone = "default" | "primary" | "danger";
type ActionVariant = "row" | "card";

function actionToneClassName(tone: ActionTone, disabled: boolean) {
  if (disabled) {
    return "pointer-events-none text-white/20";
  }

  if (tone === "primary") {
    return "text-primary hover:bg-primary/10";
  }

  if (tone === "danger") {
    return "text-red-300/80 hover:bg-red-500/10 hover:text-red-300";
  }

  return "text-white/45 hover:bg-white/10 hover:text-white";
}

function actionVariantClassName(variant: ActionVariant) {
  if (variant === "card") {
    return "h-9 w-9 border border-white/10 bg-black/55 backdrop-blur-md hover:bg-black/70";
  }

  return "h-10 w-10";
}

interface ActionIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: ActionTone;
  variant?: ActionVariant;
  children: ReactNode;
}

export const ActionIconButton = forwardRef<HTMLButtonElement, ActionIconButtonProps>(
  function ActionIconButton(
    {
      active = false,
      className,
      disabled = false,
      tone = "default",
      type = "button",
      variant = "row",
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center rounded-full transition-colors",
          actionVariantClassName(variant),
          actionToneClassName(active ? "primary" : tone, disabled),
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

interface ActionIconLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  disabled?: boolean;
  tone?: ActionTone;
  variant?: ActionVariant;
  children: ReactNode;
}

export function ActionIconLink({
  active = false,
  children,
  className,
  disabled = false,
  href,
  tone = "default",
  variant = "row",
  ...props
}: ActionIconLinkProps) {
  return (
    <a
      href={href || "#"}
      aria-disabled={disabled || !href}
      className={cn(
        "flex items-center justify-center rounded-full transition-colors",
        actionVariantClassName(variant),
        actionToneClassName(active ? "primary" : tone, disabled || !href),
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
