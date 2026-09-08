export interface SocialSummary {
  followers_count: number;
  following_count: number;
  friends_count: number;
  profile: {
    id: number;
    username: string | null;
    display_name: string | null;
    avatar: string | null;
    bio: string | null;
  };
}

export interface UserSearchResult {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  joined_at: string;
}
