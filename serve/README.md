# Move server (Modal)

Signed-in players can play the **large Convolutional bot on our servers**, at any
depth (1–3), up to **200 moves per hour each**. The web app sends the position;
this service searches on a GPU and returns the move.

| File | What it is |
|---|---|
| [`move_service.py`](move_service.py) | The service: request validation, quota check, search, ONNX Runtime model, FastAPI app |
| [`modal_app.py`](modal_app.py) | The Modal deployment (GPU container, image, secrets) and a GPU benchmark |
| [`test_move_service.py`](test_move_service.py) | Tests on the CPU with the untrained fixture model (`pytest serve`) |
| [`../supabase/migrations/20261020000000_model_server_quota.sql`](../supabase/migrations/20261020000000_model_server_quota.sql) | The hourly quota |

## How a move is served

```
browser ── POST /move {fen, pgn, depth} + the player's Supabase access token ──► Modal (GPU)
   1. validate the position (a bad request spends no quota)
   2. Supabase RPC consume_model_move(), called with the player's token:
      verifies the token, refuses guests, spends 1 of 200 moves/hour (atomic)
   3. search: mate in one first, else full-width negamax to the depth,
      every horizon position evaluated by the network in large GPU batches
◄── {move, san, score, depth, positions, elapsed_ms, limit, remaining}
```

- **Threefold repetition.** The request carries the game's moves (`pgn`), so the
  server sees repetitions exactly as the browser does.
- **Errors.** No or expired session → 401. A guest session → 401. Over the limit →
  429 with `Retry-After`. The web app turns each into a message for the player.
- **Big trees.** A search never evaluates more than 400,000 positions. A position
  with that many lines searches one ply less, and the response reports the depth used.

### What makes it fast

- **GPU batching.** The C++ engine expands the search tree on the CPU. Every
  position at the horizon then goes to the network in batches of up to 8,192.
- **Transpositions.** Positions reached by different move orders are evaluated
  once. That removes about a quarter of a depth-3 search.
- **Float16.** At startup the model is converted to float16, and kept only if
  its probabilities match float32 within 0.002. On the trained medium model the
  gap is 0.0007.
- **Fixed batch sizes.** Batches are padded to six sizes, so cuDNN picks its
  kernels once, while warming up, and not on a player's move.
- **Warm containers.** A container stays warm for 10 minutes after a move.
- **Fast misses.** A mate in one skips the search, and an invalid request never
  reaches Supabase or the GPU.

On a 4-core CPU a large-sized network evaluates about 2,000 positions per
second, so a depth-3 move (44k–98k positions) takes 20–45 s there. On the GPU it
should take well under a second, but this hasn't been measured yet. Measure it
with `modal run serve/modal_app.py` before going live.

## Deploying

One-time setup:

1. **The model.** Export the large network to `web/public/models/value_net_large.onnx`
   (see `ai/README.md`), or point `PYCHESS_MODEL` at another `.onnx` file.
2. **The quota.** Apply the migration to the Supabase project:
   `supabase db push` (or run the SQL file in the dashboard's SQL editor).
3. **Modal.** Install the client and log in, then store the Supabase URL and anon
   key as a secret:
   ```sh
   pip install modal
   modal setup
   modal secret create pychess-supabase SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key>
   ```
   The anon key is the public one the web app already uses; no service key is needed.

Then, from the repository root:

```sh
modal run serve/modal_app.py      # optional: benchmark on the GPU, nothing deployed
modal deploy serve/modal_app.py   # prints the endpoint URL
```

Finally, set `NEXT_PUBLIC_MODEL_SERVER_URL` to that URL in Vercel (and in
`web/.env.local` for local development) and redeploy the web app. Until it is
set, the web app doesn't show the server option.

### Settings (environment variables at deploy time)

| Variable | Default | Meaning |
|---|---|---|
| `PYCHESS_MODEL` | `web/public/models/value_net_large.onnx` | The network to serve |
| `PYCHESS_GPU` | `L4` | Modal GPU type (`T4` is cheaper and slower), or `cpu` (below) |
| `PYCHESS_MIN_CONTAINERS` | `0` | Containers kept running; `1` removes cold starts (about 20 s) but is billed while idle |
| `PYCHESS_ALLOWED_ORIGINS` | `https://www.pychess.app,https://pychess.app,http://localhost:3000` | Sites allowed to call the server |

### Without a GPU

Modal asks for a payment method before it runs GPU functions. To run on CPUs
instead, deploy with `PYCHESS_GPU=cpu`:

```sh
PYCHESS_GPU=cpu modal run serve/modal_app.py      # benchmark
PYCHESS_GPU=cpu modal deploy serve/modal_app.py
```

(PowerShell: `$env:PYCHESS_GPU = "cpu"` first.) The container gets 8 CPU cores and
the CPU build of ONNX Runtime. Searches are capped at depth 2: a depth-3 request is
searched to depth 2, and the response's `depth` says so, which the game screen
shows. With the large model on 4 cores, depth 2 takes 0.15–1.3 s per move; depth 3
would take 20–45 s. Deploy again without the variable to switch back to the GPU.

To change the limit of 200 moves per hour, edit `v_limit` in the migration (a new
migration that replaces the function).
