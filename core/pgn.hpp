// pgn.hpp — reading PGN game records into position sequences.
//
// This is the front of the training-data pipeline: a PGN file is split into
// games, each game's movetext is tokenised into SAN moves, and the moves are
// replayed through the engine. Replaying (rather than trusting the text)
// validates every move and yields the exact Board after each ply, which is
// what the network trains on.
//
// Host-only (std::string); header-only like the rest of the core.

#pragma once
#include "game.hpp"
#include <string>
#include <utility>
#include <vector>

namespace chess {

struct PgnGame {
    std::vector<std::pair<std::string, std::string>> tags;   // in file order
    std::string movetext;

    const std::string* tag(const std::string& name) const {
        for (const auto& t : tags) if (t.first == name) return &t.second;
        return nullptr;
    }
};

// Parses a tag-pair line `[Name "value"]`, un-escaping \" and \\.
inline bool parsePgnTag(const std::string& line, std::string& name, std::string& value) {
    size_t i = 0;
    while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) ++i;
    if (i >= line.size() || line[i] != '[') return false;
    ++i;
    size_t nameStart = i;
    while (i < line.size() && (std::isalnum(static_cast<unsigned char>(line[i])) || line[i] == '_')) ++i;
    if (i == nameStart) return false;
    name = line.substr(nameStart, i - nameStart);
    while (i < line.size() && line[i] == ' ') ++i;
    if (i >= line.size() || line[i] != '"') return false;
    ++i;
    value.clear();
    for (; i < line.size() && line[i] != '"'; ++i) {
        if (line[i] == '\\' && i + 1 < line.size()) ++i;
        value += line[i];
    }
    if (i >= line.size()) return false;           // unterminated string
    return line.find(']', i) != std::string::npos;
}

// Splits PGN text into games. A game is a block of tag pairs followed by
// movetext; a tag line after movetext (or after the blank line that ends the
// tags) starts the next game. Lines starting with '%' are escapes, ignored.
inline std::vector<PgnGame> splitPgn(const std::string& text) {
    std::vector<PgnGame> games;
    PgnGame cur;
    bool inMovetext = false;
    auto flush = [&] {
        if (!cur.tags.empty() || !cur.movetext.empty()) games.push_back(std::move(cur));
        cur = PgnGame();
        inMovetext = false;
    };
    size_t pos = 0;
    while (pos <= text.size()) {
        size_t nl = text.find('\n', pos);
        if (nl == std::string::npos) nl = text.size();
        std::string line = text.substr(pos, nl - pos);
        pos = nl + 1;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty() && line[0] == '%') continue;

        std::string name, value;
        if (parsePgnTag(line, name, value)) {
            if (inMovetext || !cur.movetext.empty()) flush();
            cur.tags.emplace_back(name, value);
            continue;
        }
        bool blank = line.find_first_not_of(" \t") == std::string::npos;
        if (blank) {
            if (!cur.tags.empty()) inMovetext = true;
            continue;
        }
        if (!cur.movetext.empty()) cur.movetext += ' ';
        cur.movetext += line;
        inMovetext = true;
    }
    flush();
    return games;
}

inline bool isResultToken(const std::string& t) {
    return t == "1-0" || t == "0-1" || t == "1/2-1/2" || t == "*";
}

// Movetext -> SAN tokens. Drops comments ({...} and ; to end of line),
// variations ((...), nested), numeric annotation glyphs ($n), move numbers
// ("12." / "12..." even when glued to the move, as in "12.e4"), suffix-only
// annotation tokens ("!", "?!") and the game-termination marker, which is
// returned through `result` if given.
inline std::vector<std::string> sanTokens(const std::string& movetext,
                                          std::string* result = nullptr) {
    std::vector<std::string> out;
    if (result) result->clear();
    int depth = 0;           // variation nesting
    std::string tok;
    auto finish = [&] {
        if (tok.empty()) return;
        std::string t = tok;
        tok.clear();
        if (depth > 0) return;
        // Strip a leading move number: digits followed by one or more dots.
        size_t k = 0;
        while (k < t.size() && std::isdigit(static_cast<unsigned char>(t[k]))) ++k;
        if (k > 0 && k < t.size() && t[k] == '.') {
            while (k < t.size() && t[k] == '.') ++k;
            t = t.substr(k);
        } else if (k == t.size()) {
            return;                                   // bare number
        }
        if (t.empty()) return;
        if (isResultToken(t)) { if (result) *result = t; return; }
        if (t.find_first_not_of("!?+-=/") == std::string::npos) return;   // "!", "+-"
        out.push_back(t);
    };
    for (size_t i = 0; i < movetext.size(); ++i) {
        const char c = movetext[i];
        if (c == '{') {                               // comment
            finish();
            size_t e = movetext.find('}', i);
            i = (e == std::string::npos) ? movetext.size() : e;
        } else if (c == ';') {                        // rest-of-line comment
            finish();
            size_t e = movetext.find('\n', i);
            i = (e == std::string::npos) ? movetext.size() : e;
        } else if (c == '(') {
            finish(); ++depth;
        } else if (c == ')') {
            finish(); if (depth > 0) --depth;
        } else if (c == '$') {                        // NAG
            finish();
            while (i + 1 < movetext.size() && std::isdigit(static_cast<unsigned char>(movetext[i + 1]))) ++i;
        } else if (std::isspace(static_cast<unsigned char>(c))) {
            finish();
        } else {
            tok += c;
        }
    }
    finish();
    return out;
}

// One replayed game: positions[i] is the board after i plies (positions[0]
// is the start), moves[i] the move played from positions[i].
struct Replay {
    std::vector<Board> positions;
    std::vector<Move>  moves;
    std::string result;          // termination marker found in the movetext
    int errorPly = -1;           // index of the first SAN that failed, or -1
    std::string error;
    bool ok() const { return errorPly < 0; }
};

// Replays SAN tokens from `start`. Stops at the first bad move, keeping the
// positions reached so far.
inline Replay replaySan(const std::vector<std::string>& sans, const Board& start) {
    Replay r;
    r.positions.reserve(sans.size() + 1);
    r.moves.reserve(sans.size());
    Board b = start;
    r.positions.push_back(b);
    for (size_t i = 0; i < sans.size(); ++i) {
        Move m;
        std::string err;
        if (!parseSan(b, sans[i], m, &err)) {
            r.errorPly = static_cast<int>(i);
            r.error = "ply " + std::to_string(i + 1) + ": " + err;
            break;
        }
        Undo u;
        b.makeMove(m, u);
        r.moves.push_back(m);
        r.positions.push_back(b);
    }
    return r;
}

inline Replay replayMovetext(const std::string& movetext,
                             const Board& start = Board::startpos()) {
    std::string result;
    std::vector<std::string> sans = sanTokens(movetext, &result);
    Replay r = replaySan(sans, start);
    r.result = result;
    return r;
}

// The starting position of a game: its FEN tag if it has one, else the
// standard start. Returns false for an unparseable FEN.
inline bool gameStart(const PgnGame& g, Board& out) {
    const std::string* fen = g.tag("FEN");
    if (!fen) { out = Board::startpos(); return true; }
    return out.setFromFEN(*fen);
}

} // namespace chess
