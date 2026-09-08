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
  if (!date)
    return {
      dateLabel: "",
      monthLabel: "",
      dayLabel: "",
      weekdayLabel: "",
      timeLabel: "",
    };
  const value = new Date(`${date}T12:00:00`);
  return {
    dateLabel: value.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    monthLabel: value
      .toLocaleDateString("en-US", { month: "short" })
      .toUpperCase(),
    dayLabel: String(value.getDate()),
    weekdayLabel: value
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase(),
    timeLabel: time ? time.slice(0, 5) : "",
  };
}

const DEFAULT_GENRE_COLOR = "var(--genre-tone-default)";

export const GENRE_COLOR_TOKENS: Record<string, string> = {
  metal: "--genre-tone-ink",
  "heavy metal": "--genre-tone-ink",
  "death metal": "--genre-tone-ink",
  "black metal": "--genre-tone-ink",
  "doom metal": "--genre-tone-ink-strong",
  punk: "--genre-tone-warm-strong",
  hardcore: "--genre-tone-warm-strong",
  "hardcore punk": "--genre-tone-warm-strong",
  "post-hardcore": "--genre-tone-warm",
  grindcore: "--genre-tone-warm-strong",
  rock: "--genre-tone-cool",
  "alternative rock": "--genre-tone-cool",
  "indie rock": "--genre-tone-cool-accent",
  grunge: "--genre-tone-muted",
  "post-punk": "--genre-tone-cool-accent",
  shoegaze: "--genre-tone-cool-accent",
  electronic: "--genre-tone-default",
  ambient: "--genre-tone-cool-accent",
  noise: "--genre-tone-muted",
  experimental: "--genre-tone-cool-accent",
  "math rock": "--genre-tone-success",
  emo: "--genre-tone-warm-strong",
  screamo: "--genre-tone-warm-strong",
  "hip hop": "--genre-tone-warm",
  jazz: "--genre-tone-warm",
  folk: "--genre-tone-success",
};

const GENRE_COLOR_ENTRIES = Object.entries(GENRE_COLOR_TOKENS).sort(
  ([left], [right]) => right.length - left.length,
);

function asGenreColor(tokenName: string): string {
  return `var(${tokenName})`;
}

export function getGenreColor(genres?: string[]): string {
  if (!genres || genres.length === 0) return DEFAULT_GENRE_COLOR;

  for (const genre of genres) {
    const lower = genre.trim().toLowerCase();
    if (!lower) continue;

    const exactToken = GENRE_COLOR_TOKENS[lower];
    if (exactToken) return asGenreColor(exactToken);

    for (const [key, tokenName] of GENRE_COLOR_ENTRIES) {
      if (lower.includes(key) || key.includes(lower)) {
        return asGenreColor(tokenName);
      }
    }
  }

  return DEFAULT_GENRE_COLOR;
}
