import { useEffect, useState } from "react";

import { canUseHoverPointer, subscribeHoverPointer } from "@/lib/input-capabilities";

export function useHoverCapability(): boolean {
  const [canHover, setCanHover] = useState(canUseHoverPointer);

  useEffect(() => subscribeHoverPointer(setCanHover), []);

  return canHover;
}
