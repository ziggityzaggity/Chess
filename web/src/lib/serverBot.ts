// serverBot.ts — moves from the move server (serve/ in the repository, on Modal).
//
// Signed-in players can play the large Convolutional bot there at any depth,
// up to SERVER_MOVES_PER_HOUR moves an hour. The request carries the player's
// Supabase access token; the server checks it and the quota with Supabase,
// searches on a GPU and returns the move.

/** The move server's base URL; empty when it isn't set up (the option is then hidden). */
export const MODEL_SERVER_URL = (process.env.NEXT_PUBLIC_MODEL_SERVER_URL ?? "").replace(/\/+$/, "");
export const SERVER_MOVES_PER_HOUR = 200;

export function serverConfigured(): boolean {
  return MODEL_SERVER_URL !== "";
}

export interface ServerMove {
  move: string; // UCI
  san: string;
  score: number; // expected score for the mover, 0..1
  depth: number; // plies searched
  positions: number; // positions the network evaluated
  elapsed_ms: number;
  limit: number; // moves per hour
  remaining: number; // moves left this hour
}

export type ServerBotErrorCode = "sign_in_required" | "rate_limited" | "bad_position" | "unavailable";

export class ServerBotError extends Error {
  constructor(
    message: string,
    readonly code: ServerBotErrorCode,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = "ServerBotError";
  }
}

export const SIGN_IN_MESSAGE = "Sign in to play the large model on our servers.";

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Ask the move server for a move. Throws ServerBotError with a message fit to show the player. */
export async function requestServerMove(request: {
  token: string;
  fen: string;
  pgn: string;
  depth: number;
  signal?: AbortSignal;
  url?: string;
}): Promise<ServerMove> {
  const url = request.url ?? MODEL_SERVER_URL;
  let response: Response;
  try {
    response = await fetch(`${url}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.token}` },
      body: JSON.stringify({ fen: request.fen, pgn: request.pgn, depth: request.depth }),
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal?.aborted) throw err;
    throw new ServerBotError("The move server can't be reached right now. Try again shortly.", "unavailable");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body as unknown as ServerMove;
  if (response.status === 401) throw new ServerBotError(SIGN_IN_MESSAGE, "sign_in_required");
  if (response.status === 429) {
    const retry = Number(body.retry_after_s ?? response.headers.get("Retry-After") ?? 0);
    throw new ServerBotError(
      `You've used all ${body.limit ?? SERVER_MOVES_PER_HOUR} server moves this hour. ` +
        `More free up in ${minutes(retry)}; you can play in your browser meanwhile.`,
      "rate_limited",
      retry,
    );
  }
  if (response.status === 400) {
    throw new ServerBotError(String(body.message ?? "The server couldn't read this position."), "bad_position");
  }
  throw new ServerBotError("The move server is unavailable right now. Try again shortly.", "unavailable");
}
