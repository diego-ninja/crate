import type { UpcomingItem } from "@/components/upcoming/UpcomingRows";

export type { UpcomingItem };

export interface UpcomingResponse {
  items: UpcomingItem[];
  summary: {
    followed_artists: number;
    show_count: number;
    release_count: number;
    attending_count: number;
    insight_count: number;
  };
}

export interface GenreShowsResponse {
  name: string;
  slug: string;
  shows?: UpcomingItem[];
}
