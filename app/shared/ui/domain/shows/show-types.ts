export interface ShowArtistRef {
  name: string;
  id?: number;
  slug?: string;
}

export interface NormalizedShow {
  id?: string | number;
  date: string;
  time: string;
  venue: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  url: string;
  status: string;
  title: string;
  primaryArtist: ShowArtistRef | null;
  lineupArtists: ShowArtistRef[];
  genres: string[];
  coverUrl: string;
  artistPhotoUrl: string;
  backgroundUrl: string;
}

export function formatShowDateParts(date: string, time: string) {
  if (!date) return { dateLabel: "", monthLabel: "", dayLabel: "", weekdayLabel: "", timeLabel: "" };
  const value = new Date(`${date}T12:00:00`);
  return {
    dateLabel: value.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    monthLabel: value.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    dayLabel: String(value.getDate()),
    weekdayLabel: value.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    timeLabel: time ? time.slice(0, 5) : "",
  };
}

export const GENRE_COLORS: Record<string, string> = {
  metal: "#1f2937",
  "heavy metal": "#1f2937",
  "death metal": "#1f2937",
  "black metal": "#1f2937",
  "doom metal": "#374151",
  punk: "#dc2626",
  hardcore: "#dc2626",
  "hardcore punk": "#dc2626",
  "post-hardcore": "#ea580c",
  grindcore: "#991b1b",
  rock: "#2563eb",
  "alternative rock": "#3b82f6",
  "indie rock": "#6366f1",
  grunge: "#4b5563",
  "post-punk": "#7c3aed",
  shoegaze: "#a78bfa",
  electronic: "#06b6d4",
  ambient: "#0e7490",
  noise: "#78716c",
  experimental: "#a855f7",
  "math rock": "#14b8a6",
  emo: "#f43f5e",
  screamo: "#e11d48",
  "hip hop": "#eab308",
  jazz: "#f59e0b",
  folk: "#65a30d",
};

export function getGenreColor(genres?: string[]): string {
  if (!genres || genres.length === 0) return "#06b6d4";
  for (const genre of genres) {
    const lower = genre.toLowerCase();
    if (GENRE_COLORS[lower]) return GENRE_COLORS[lower]!;
    for (const [key, color] of Object.entries(GENRE_COLORS)) {
      if (lower.includes(key) || key.includes(lower)) return color;
    }
  }
  return "#06b6d4";
}
