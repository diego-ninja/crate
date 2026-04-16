import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`'".,/:!?()[\]]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
