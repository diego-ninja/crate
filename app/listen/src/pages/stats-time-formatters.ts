const WEEKDAY_INDEX_BY_ENGLISH = new Map(
  [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].map((weekday, index) => [weekday, index] as const),
);

export function formatWeekdayLabel(weekday: string, locale: string): string {
  const weekdayIndex = WEEKDAY_INDEX_BY_ENGLISH.get(weekday.toLowerCase());
  if (weekdayIndex == null) return weekday;
  const date = new Date(Date.UTC(2026, 0, 4 + weekdayIndex, 12));
  return date.toLocaleDateString(locale, { weekday: "long" });
}
