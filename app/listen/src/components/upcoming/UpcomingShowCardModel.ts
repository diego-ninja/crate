import type { TFunction } from "i18next";

import type { UpcomingItem } from "./upcoming-model";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function formatShowTimeRemaining(
  item: UpcomingItem,
  tOrNow?: TFunction | Date,
  nowArg = new Date(),
): string | null {
  if (!item.date) return null;

  const t = typeof tOrNow === "function" ? tOrNow : null;
  const now = tOrNow instanceof Date ? tOrNow : nowArg;

  const showDate = new Date(`${item.date}T${item.time || "12:00:00"}`);
  if (Number.isNaN(showDate.getTime())) return null;

  const diff = showDate.getTime() - now.getTime();
  if (diff <= 0) return t ? t("radar.show.time.showTime") : "Show time";

  const days = Math.floor(diff / DAY_MS);
  if (days >= 60) {
    const count = Math.round(days / 30);
    return t
      ? t("radar.show.time.monthsToGo", { count })
      : `${count} months to go`;
  }
  if (days >= 30) {
    return t ? t("radar.show.time.oneMonthToGo") : "1 month to go";
  }
  if (days >= 1) {
    return t
      ? t("radar.show.time.daysToGo", { count: days })
      : `${days} ${days === 1 ? "day" : "days"} to go`;
  }

  const hours = Math.floor(diff / HOUR_MS);
  if (hours >= 1) {
    return t
      ? t("radar.show.time.hoursToGo", { count: hours })
      : `${hours} ${hours === 1 ? "hour" : "hours"} to go`;
  }

  return t ? t("radar.show.time.startingSoon") : "Starting soon";
}

function showDestination(item: UpcomingItem): string | null {
  if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    return `${item.latitude},${item.longitude}`;
  }

  const destination = [
    item.venue,
    item.address_line1,
    item.city,
    item.region,
    item.postal_code,
    item.country,
  ]
    .filter(Boolean)
    .join(", ");

  return destination || null;
}

export function showDirectionsUrl(
  item: UpcomingItem,
  provider: "auto" | "apple" | "google" = "auto",
): string | null {
  const destination = showDestination(item);
  if (!destination) return null;

  const encodedDestination = encodeURIComponent(destination);
  const isApplePlatform =
    provider === "apple" ||
    (provider === "auto" &&
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent));

  if (isApplePlatform) {
    return `https://maps.apple.com/?daddr=${encodedDestination}`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}`;
}
