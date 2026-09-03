// Hand-maintained types for the PyChess Supabase schema.
// Mirrors supabase/migrations — regenerate with `supabase gen types typescript`
// once a CLI login is available, if the schema grows.
//
// These are `type` aliases (not interfaces) on purpose: supabase-js constrains
// rows to Record<string, unknown>, which interfaces don't implicitly satisfy.

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export type ProfileRow = {
  id: string;
  nickname: string | null;
  birth_date: string | null; // ISO date (YYYY-MM-DD)
  avatar: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GameRow = {
  id: string;
  owner_id: string;
  pgn: string;
  result: "1-0" | "0-1" | "1/2-1/2" | "*" | null;
  opponent: string | null;
  played_at: string;
  created_at: string;
};

export type FriendshipRow = {
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      games: {
        Row: GameRow;
        Insert: Partial<GameRow> & { owner_id: string; pgn: string };
        Update: Partial<GameRow>;
        Relationships: [];
      };
      friendships: {
        Row: FriendshipRow;
        Insert: Partial<FriendshipRow> & {
          requester_id: string;
          addressee_id: string;
        };
        Update: Partial<FriendshipRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { friendship_status: FriendshipStatus };
    CompositeTypes: Record<string, never>;
  };
};
