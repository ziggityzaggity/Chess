"use client";

// Data helpers for saved games and friends. No UI uses these yet — they're the
// client-side surface of the `games` and `friendships` tables so game history
// and a friends list can be built on top without schema work.

import { getSupabase } from "@/lib/supabase/client";
import type { FriendshipRow, GameRow, ProfileRow } from "@/lib/database.types";

const NOT_CONFIGURED = new Error("Supabase is not configured");

/** Save a finished game as PGN for the signed-in user. */
export async function saveGame(input: {
  pgn: string;
  result?: GameRow["result"];
  opponent?: string;
  playedAt?: Date;
}): Promise<GameRow> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You need to be signed in to save games.");

  const { data, error } = await supabase
    .from("games")
    .insert({
      owner_id: user.id,
      pgn: input.pgn,
      result: input.result ?? null,
      opponent: input.opponent ?? null,
      ...(input.playedAt ? { played_at: input.playedAt.toISOString() } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** The signed-in user's games, newest first. */
export async function listGames(limit = 50): Promise<GameRow[]> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const { data, error } = await supabase
    .from("games")
    .select()
    .order("played_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Send a friend request to another player by their profile id. */
export async function sendFriendRequest(addresseeId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You need to be signed in.");
  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: user.id, addressee_id: addresseeId });
  if (error) throw error;
}

/** Accept (or block) a pending request addressed to the signed-in user. */
export async function respondToFriendRequest(
  requesterId: string,
  status: "accepted" | "blocked"
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You need to be signed in.");
  const { error } = await supabase
    .from("friendships")
    .update({ status })
    .eq("requester_id", requesterId)
    .eq("addressee_id", user.id);
  if (error) throw error;
}

/** All friendship rows involving the signed-in user. */
export async function listFriendships(): Promise<FriendshipRow[]> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const { data, error } = await supabase.from("friendships").select();
  if (error) throw error;
  return data;
}

/** Look up players by (partial) nickname, e.g. for an "add friend" box. */
export async function searchPlayers(
  nickname: string,
  limit = 10
): Promise<Pick<ProfileRow, "id" | "nickname" | "avatar">[]> {
  const supabase = getSupabase();
  if (!supabase) throw NOT_CONFIGURED;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nickname, avatar")
    .ilike("nickname", `%${nickname}%`)
    .limit(limit);
  if (error) throw error;
  return data;
}
