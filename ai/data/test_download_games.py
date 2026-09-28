"""Tests for the game-selection rules in download_games.py (no network needed)."""

import download_games as dg

GOOD = {"Event": "26th ch-EUR Indiv 2026", "Site": "Batumi GEO", "Result": "1-0",
        "WhiteElo": "2450", "BlackElo": "2390"}


def test_keeps_otb_classical_games():
    assert dg.reject_reason(GOOD, "e4 e5", 2300) is None
    # Team leagues span two years; "2025-26" is a season, not a time control.
    for event in ("Bundesliga 2025-26", "4NCL 2025-26", "2nd Bundesliga Nord 25-26", "Hastings Masters 2025-26"):
        assert dg.reject_reason({**GOOD, "Event": event}, "e4", 2300) is None, event


def test_rejects_fast_online_and_engine_games():
    for event in ("Titled Tue 2nd Jun 2026", "1st 3-0 Thu 11th Jun 2026", "Baltic Countries Rapid",
                  "World Blitz 2025", "14th Norway Armageddon", "TCEC 29 Superfinal 2026",
                  "Chess.com Open PlayIn1", "Freestyle Chess GOAT", "Simul Kasparov"):
        assert dg.reject_reason({**GOOD, "Event": event}, "e4", 2300) == "not OTB classical", event
    assert dg.reject_reason({**GOOD, "Site": "Chess.com INT"}, "e4", 2300) == "not OTB classical"


def test_rejects_weak_unrated_unfinished_and_nonstandard():
    assert dg.reject_reason({**GOOD, "BlackElo": "2299"}, "e4", 2300) == "a player below 2300"
    assert dg.reject_reason({k: v for k, v in GOOD.items() if k != "WhiteElo"}, "e4", 2300) == "missing Elo"
    assert dg.reject_reason({**GOOD, "Result": "*"}, "e4", 2300) == "no result"
    assert dg.reject_reason({**GOOD, "FEN": "8/8/8/8/8/8/8/K6k w - - 0 1"}, "e4", 2300) == "non-standard start"
    assert dg.reject_reason({**GOOD, "Variant": "Chess960"}, "e4", 2300) == "non-standard start"
    assert dg.reject_reason(GOOD, "", 2300) == "no moves"


def test_normalized_moves_strips_annotations():
    text = "1. e4 {comment} e5 (1... c5 2. Nf3 (2. c3)) 2. Nf3 $1 Nc6 3.Bb5 1-0"
    assert dg.normalized_moves(text) == "e4 e5 Nf3 Nc6 Bb5"


def test_split_games_handles_empty_movetext():
    pgn = ('[Event "A"]\n[Result "1-0"]\n\n\n'          # forfeit: no moves at all
           '[Event "B"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n\n'
           '[Event "C"]\n[Result "*"]\n\n1. d4 *\n')
    games = list(dg.split_games(pgn))
    assert [h["Event"] for h, _ in games] == ["A", "B", "C"]
    assert games[0][1] == "" and games[1][1].endswith("Qh4# 0-1")


def test_format_game_round_trips():
    movetext = " ".join(f"{i}. e4 e5" for i in range(1, 30)) + " 1/2-1/2"
    text = dg.format_game(GOOD, movetext)
    assert all(len(line) <= 79 for line in text.splitlines())
    [(headers, again)] = list(dg.split_games(text))
    assert headers == GOOD and again == movetext
