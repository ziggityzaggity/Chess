#!/usr/bin/env python3
"""Download and curate the training games for the value network.

Source
------
The Week in Chess (TWIC, https://theweekinchess.com, edited by Mark Crowther)
publishes every week's over-the-board (OTB) games from tournaments worldwide,
with full FIDE Elo, title, event and date headers. We read the weekly issues
from the rozim/ChessData GitHub mirror pinned to one commit, so every run
downloads byte-identical files. ``--source twic`` fetches the same issues from
the official TWIC zips instead.

Selection ("highly relevant" games)
-----------------------------------
Each weekly issue also contains online blitz (e.g. Titled Tuesday), rapid,
blitz, Armageddon, engine (TCEC) and exhibition games. For a model that learns
"who is winning from this position", we keep games whose result reflects the
position on the board:

* standard chess from the initial position (no FEN/SetUp, no Chess960);
* OTB classical time control: events whose name or site mark them as rapid,
  blitz, bullet, Armageddon, online, engine, blindfold, simul, playoff or
  tiebreak are excluded;
* both players FIDE-rated >= --min-elo (default 2300, roughly FM strength and
  up), so outcomes are driven by the position rather than by blunders;
* a proper result tag (1-0, 0-1, 1/2-1/2) and at least one move;
* de-duplicated (TWIC occasionally republishes corrected games).

Walking back from the newest issue, we collect the --target most recent games
that pass. Model-specific cleaning, like dropping very short "agreed" draws,
belongs to the notebook, so this file stays a faithful subset of the source.

Only the Python standard library is used, so this runs anywhere (including
Colab) with no installs.

    python ai/data/download_games.py            # writes ai/data/twic_otb2300.pgn
    python ai/data/download_games.py --target 5000 --min-elo 2400
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# rozim/ChessData is a long-lived PGN mirror that includes every TWIC issue.
# Pinning a commit makes the download reproducible.
MIRROR_COMMIT = "ed88abd2716da58ee55d42b662455c1c8ebe0776"
MIRROR_URL = "https://raw.githubusercontent.com/rozim/ChessData/{commit}/Twic/twic{n}.pgn"
TWIC_URL = "https://theweekinchess.com/zips/twic{n}g.zip"

NEWEST_ISSUE = 1649  # 2026-06-09, the newest issue in the pinned mirror commit

# Event/Site patterns for games that are not OTB classical chess. The single
# digit "\d-\d" catches arena names like "1st 3-0 Thu" without matching team
# seasons such as "Bundesliga 2025-26".
NON_CLASSICAL = re.compile(
    r"rapid|blitz|bullet|armageddon|blind|simul|exhibition|960|freestyle|"
    r"fischer random|titled|(?<![\d-])\d-\d(?![\d-])|online|chess\.com|lichess|"
    r"tcec|computer|engine|ccrl|speed|playoff|play-off|tiebreak|tie-break|"
    r"bughouse|odds|handicap",
    re.IGNORECASE,
)
RESULTS = ("1-0", "0-1", "1/2-1/2")
TAG_RE = re.compile(r'^\[(\w+)\s+"(.*)"\]\s*$')
MOVE_NUMBER_RE = re.compile(r"\d+\.(\.\.)?")


def fetch(url: str, attempts: int = 5) -> bytes:
    """GET with exponential backoff (2s, 4s, 8s, ...)."""
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pychess-data/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
                raise
            if attempt == attempts:
                raise
            print(f"  retry {attempt}/{attempts - 1} for {url}: {exc}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


def issue_text(n: int, source: str, cache: Path | None) -> str:
    """Return the PGN text of TWIC issue `n`, using/filling the cache."""
    cached = cache / f"twic{n}.pgn" if cache else None
    if cached and cached.exists():
        raw = cached.read_bytes()
    elif source == "github":
        raw = fetch(MIRROR_URL.format(commit=MIRROR_COMMIT, n=n))
    else:
        with zipfile.ZipFile(io.BytesIO(fetch(TWIC_URL.format(n=n)))) as zf:
            name = next(x for x in zf.namelist() if x.lower().endswith(".pgn"))
            raw = zf.read(name)
    if cached and not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(raw)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:  # the official zips are Latin-1
        return raw.decode("latin-1")


def split_games(text: str):
    """Yield (headers, movetext) pairs from PGN text."""
    headers: dict[str, str] = {}
    moves: list[str] = []
    in_movetext = False  # set by the blank line that ends a tag section
    for line in text.splitlines():
        m = TAG_RE.match(line)
        if m:
            if in_movetext or moves:
                if headers:
                    yield headers, " ".join(moves)
                headers, moves, in_movetext = {}, [], False
            headers[m.group(1)] = m.group(2)
        elif not line.strip():
            in_movetext = bool(headers)
        elif headers:
            moves.append(line.strip())
    if headers:
        yield headers, " ".join(moves)


def normalized_moves(movetext: str) -> str:
    """Movetext without comments, variations, NAGs, move numbers or result."""
    s = re.sub(r"\{[^}]*\}", " ", movetext)
    while "(" in s:  # strip (nested) variations innermost-first
        t = re.sub(r"\([^()]*\)", " ", s)
        if t == s:
            break
        s = t
    s = MOVE_NUMBER_RE.sub(" ", s)
    toks = [t for t in s.split() if t not in RESULTS + ("*",) and not t.startswith("$")]
    return " ".join(toks)


def reject_reason(h: dict[str, str], moves: str, min_elo: int) -> str | None:
    """Why a game fails the selection, or None if it is kept."""
    if h.get("Result") not in RESULTS:
        return "no result"
    if "FEN" in h or h.get("SetUp") == "1" or h.get("Variant", "Standard").lower() != "standard":
        return "non-standard start"
    if NON_CLASSICAL.search(h.get("Event", "") + " | " + h.get("Site", "")):
        return "not OTB classical"
    try:
        if min(int(h["WhiteElo"]), int(h["BlackElo"])) < min_elo:
            return f"a player below {min_elo}"
    except (KeyError, ValueError):
        return "missing Elo"
    if not moves:
        return "no moves"
    return None


def format_game(h: dict[str, str], movetext: str) -> str:
    """Re-emit a game as PGN: tags, blank line, movetext wrapped at 79 cols."""
    lines = [f'[{k} "{v}"]' for k, v in h.items()]
    out, cur = [], ""
    for tok in movetext.split():
        if cur and len(cur) + 1 + len(tok) > 79:
            out.append(cur)
            cur = tok
        else:
            cur = f"{cur} {tok}" if cur else tok
    if cur:
        out.append(cur)
    return "\n".join(lines) + "\n\n" + "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=HERE / "twic_otb2300.pgn")
    ap.add_argument("--target", type=int, default=10_000, help="number of games to keep")
    ap.add_argument("--min-elo", type=int, default=2300, help="both players must be rated >= this")
    ap.add_argument("--newest", type=int, default=NEWEST_ISSUE, help="first (newest) TWIC issue to read")
    ap.add_argument("--oldest", type=int, default=1400, help="stop before reading issues older than this")
    ap.add_argument("--source", choices=("github", "twic"), default="github")
    ap.add_argument("--cache", type=Path, default=None, help="directory to cache raw issues in")
    args = ap.parse_args(argv)

    kept: list[str] = []
    seen: set[tuple[str, str, str]] = set()
    rejected: dict[str, int] = {}
    issues: list[int] = []
    dates: list[str] = []
    total = duplicates = 0

    for n in range(args.newest, args.oldest - 1, -1):
        if len(kept) >= args.target:
            break
        text = issue_text(n, args.source, args.cache)
        issues.append(n)
        before = len(kept)
        for h, movetext in split_games(text):
            total += 1
            moves = normalized_moves(movetext)
            why = reject_reason(h, moves, args.min_elo)
            if why:
                rejected[why] = rejected.get(why, 0) + 1
                continue
            key = (h.get("White", ""), h.get("Black", ""), moves)
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            kept.append(format_game(h, movetext))
            dates.append(h.get("Date", ""))
            if len(kept) >= args.target:
                break
        print(f"TWIC {n}: +{len(kept) - before:4d} games  (total {len(kept)})")

    if len(kept) < args.target:
        print(f"warning: only {len(kept)} games passed the filters", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    data = "\n".join(kept).encode("utf-8")
    args.out.write_bytes(data)

    known = sorted(d for d in dates if re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", d))
    manifest = {
        "file": args.out.name,
        "games": len(kept),
        "sha256": hashlib.sha256(data).hexdigest(),
        "source": "The Week in Chess (https://theweekinchess.com), edited by Mark Crowther",
        "mirror": None if args.source == "twic" else f"github.com/rozim/ChessData@{MIRROR_COMMIT}",
        "issues": issues,
        "date_range": [known[0], known[-1]] if known else None,
        "filters": {
            "min_elo_both_players": args.min_elo,
            "results": list(RESULTS),
            "excluded_event_pattern": NON_CLASSICAL.pattern,
            "standard_start_only": True,
            "deduplicated_on": "White + Black + movetext",
        },
        "counts": {"read": total, "rejected": rejected, "duplicates": duplicates, "kept": len(kept)},
        "created": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    manifest_path = args.out.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(kept)} games to {args.out} ({len(data) / 1e6:.1f} MB) and {manifest_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
