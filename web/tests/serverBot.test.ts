// The move-server path of the Convolutional bot, with fetch stubbed out.

import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chooseBotMove } from "../src/lib/bot";
import { botQuery, botTagline, parseBotSpec, type BotSpec } from "../src/lib/bots";
import type { ChessGame, EngineModule } from "../src/lib/engine";
import { requestServerMove, ServerBotError } from "../src/lib/serverBot";

const require = createRequire(import.meta.url);
let engine: EngineModule;
let game: ChessGame;

beforeAll(async () => {
  engine = await (require("../public/engine/chessengine.js") as () => Promise<EngineModule>)();
  game = new engine.ChessGame();
});

afterEach(() => vi.unstubAllGlobals());

const ANSWER = {
  move: "g1f3",
  san: "Nf3",
  score: 0.52,
  depth: 3,
  positions: 9000,
  elapsed_ms: 310,
  limit: 200,
  remaining: 199,
};

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const request = { token: "jwt", fen: "fen", pgn: "", depth: 3, url: "https://server.example" };

describe("the game URL", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("carries the server choice for the large model only", () => {
    const spec = parseBotSpec(params("bot=cnn&size=large&depth=3&server=1"));
    expect(spec).toEqual({ family: "cnn", size: "large", depth: 3, server: true });
    expect(parseBotSpec(params(botQuery(spec)))).toEqual(spec);
    expect(botTagline(spec)).toContain("on our servers");
    expect(parseBotSpec(params("bot=cnn&size=medium&depth=2&server=1"))).toEqual({
      family: "cnn",
      size: "medium",
      depth: 2,
    });
  });
});

describe("requestServerMove", () => {
  it("posts the position with the player's token", async () => {
    const fetch = stubFetch(200, ANSWER);
    const answer = await requestServerMove({ ...request, pgn: "1. e4 e5" });
    expect(answer).toEqual(ANSWER);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://server.example/move");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(JSON.parse(init.body as string)).toEqual({ fen: "fen", pgn: "1. e4 e5", depth: 3 });
  });

  it.each([
    [401, { error: "sign_in_required" }, {}, "sign_in_required", /Sign in/],
    [429, { error: "rate_limited", limit: 200, retry_after_s: 754 }, {}, "rate_limited", /all 200 server moves.*13 minutes/],
    [400, { error: "bad_position", message: "the game is over" }, {}, "bad_position", /the game is over/],
    [503, { error: "unavailable" }, {}, "unavailable", /unavailable/],
  ])("turns HTTP %i into a message for the player", async (status, body, headers, code, message) => {
    stubFetch(status, body, headers);
    const error = await requestServerMove(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerBotError);
    expect((error as ServerBotError).code).toBe(code);
    expect((error as ServerBotError).message).toMatch(message);
  });

  it("reports an unreachable server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(requestServerMove(request)).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("chooseBotMove on the server", () => {
  const bot: BotSpec = { family: "cnn", size: "large", depth: 3, server: true };

  it("sends the live position and history, and reports moves left", async () => {
    game.reset();
    for (const [from, to] of [
      [52, 36],
      [12, 28],
    ])
      game.doMove(from, to, "");
    const fetch = stubFetch(200, ANSWER);
    const left: number[] = [];
    const move = await chooseBotMove(engine, game, bot, {
      getAccessToken: async () => "jwt",
      onServerMove: (answer) => left.push(answer.remaining),
    });
    expect(move).toBe("g1f3");
    expect(left).toEqual([199]);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ fen: game.fen(), pgn: game.pgn(), depth: 3 });
  });

  it("asks the player to sign in without a session", async () => {
    game.reset();
    const fetch = stubFetch(200, ANSWER);
    await expect(chooseBotMove(engine, game, bot, { getAccessToken: async () => null })).rejects.toMatchObject({
      code: "sign_in_required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
