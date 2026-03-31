import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export * from "../../../shared/web/utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
