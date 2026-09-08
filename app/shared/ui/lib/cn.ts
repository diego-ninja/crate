import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const crateTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["badge"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return crateTwMerge(clsx(inputs));
}
