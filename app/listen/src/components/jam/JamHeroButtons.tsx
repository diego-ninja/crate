import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "@crate/ui/icons";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { Button } from "@crate/ui/shadcn/button";

interface HeroActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

export function HeroActionButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroActionButtonProps) {
  return (
    <ActionIconButton
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`jam-hero-action size-11 text-text-muted disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
    </ActionIconButton>
  );
}

interface HeroPrimaryButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

export function HeroPrimaryButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroPrimaryButtonProps) {
  return (
    <Button
      type="button"
      aria-label={label}
      disabled={disabled || loading}
      variant="outline"
      size="lg"
      className={`h-11 px-3.5 disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
      <span>{label}</span>
    </Button>
  );
}
