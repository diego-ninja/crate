import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import {
  applyAppearanceToRoot,
  type AppearanceResolution,
} from "@crate/ui/lib/appearance-resolver";

export interface ThemeScopeProps extends HTMLAttributes<HTMLDivElement> {
  appearance: AppearanceResolution;
  children: ReactNode;
}

export function ThemeScope({
  appearance,
  children,
  ...props
}: ThemeScopeProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!rootRef.current) return undefined;
    return applyAppearanceToRoot(rootRef.current, appearance);
  }, [appearance]);

  return (
    <div ref={rootRef} {...props}>
      {children}
    </div>
  );
}
