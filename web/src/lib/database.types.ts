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

export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "*";
export type MoveEntry = { uci: string; san: string };

export type ActiveGameRow = {
  id: string;
  code: string;
  host_id: string;
  guest_id: string | null;
  host_color: "white" | "black";
  status: "waiting" | "active" | "finished";
  fen: string;
  moves: MoveEntry[];
  move_count: number;
  time_control: string;
  host_name: string | null;
  guest_name: string | null;
  clock_white_ms: number | null;
  clock_black_ms: number | null;
  result: GameResult | null;
  end_reason: string | null;
  last_move_at: string;
  finished_at: string | null;
  created_at: string;
};

export type GameArchiveRow = {
  id: string;
  active_game_id: string | null;
  white_id: string | null;
  black_id: string | null;
  white_name: string;
  black_name: string;
  result: GameResult;
  end_reason: string | null;
  pgn: string;
  moves: MoveEntry[];
  time_control: string;
  played_at: string;
  finished_at: string;
  created_at: string;
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
      // Realtime multiplayer. Clients may only SELECT these (RLS); all writes go
      // through the RPCs / edge function below.
      active_games: {
        Row: ActiveGameRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      game_archive: {
        Row: GameArchiveRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_hosted_game: {
        Args: { p_password: string; p_host_color: string; p_time_control: string };
        Returns: { id: string; code: string }[];
      };
      join_active_game: {
        Args: { p_code: string; p_password: string; p_guest_name?: string };
        Returns: {
          ok: boolean;
          reason: string | null;
          id: string | null;
          host_color: "white" | "black" | null;
          status: string | null;
          fen: string | null;
          moves: MoveEntry[] | null;
          move_count: number | null;
          time_control: string | null;
          created_at: string | null;
        }[];
      };
      resign_active_game: {
        Args: { p_game_id: string };
        Returns: string;
      };
    };
    Enums: { friendship_status: FriendshipStatus };
    CompositeTypes: Record<string, never>;
  };
};
