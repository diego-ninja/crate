import { createContext } from "react";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  avatar?: string | null;
  username?: string | null;
  bio?: string | null;
  session_id?: string | null;
  connected_accounts?: Array<{ provider: string; status: string }>;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
