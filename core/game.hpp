// game.hpp — high-level Game wrapper around the Board core.
//
// Board (chess.hpp) is the fast POD move generator. Game adds the stateful,
// human-/app-facing layer that higher abstraction layers (a JS frontend, a
// Python ML loop) want to talk to, without ever touching engine internals:
//
//   * move history with undo / redo (objects.py's backspace/tab, done right)
//   * full game-over detection: checkmate, stalemate, 50-move, threefold
//     repetition, insufficient material -> a single result()/drawReason()
//   * convenient I/O: FEN, UCI move strings, SAN, and PGN movetext export
//   * render/query helpers: pieceAt(), legalMovesFrom() for square highlighting
//
// Still header-only and dependency-free, so it binds to WASM (embind) and
// Python (pybind11) exactly like the core.

#pragma once
#include "chess.hpp"
#include <vector>
#include <string>
#include <cctype>

namespace chess {

// ----------------------------------------------------------------------------
// Outcome types — map cleanly onto JS / Python enums.
// ----------------------------------------------------------------------------
enum class Result : uint8_t { ONGOING, WHITE_WINS, BLACK_WINS, DRAW };
enum class DrawReason : uint8_t {
    NONE, STALEMATE, FIFTY_MOVE, THREEFOLD, INSUFFICIENT_MATERIAL
};

// ----------------------------------------------------------------------------
// Small free helpers (also reused by bindings).
// ----------------------------------------------------------------------------
inline std::string squareName(int s) {
    std::string r;
    r += static_cast<char>('a' + colOf(s));
    r += static_cast<char>('0' + (8 - rowOf(s)));
    return r;
}
inline int squareFromName(const std::string& s) {
    if (s.size() < 2) return -1;
    int file = s[0] - 'a', rank = s[1] - '0';
    if (file < 0 || file > 7 || rank < 1 || rank > 8) return -1;
    return sqOf(8 - rank, file);
}
inline char pieceGlyph(uint8_t p) {
    const char* g = ".PNBRQK";
    if (!p) return '.';
    char c = g[pieceType(p)];
    return (pieceColor(p) == BLACK) ? static_cast<char>(std::tolower(c)) : c;
}

// ----------------------------------------------------------------------------
// Zobrist position key — used for threefold repetition (and handy later for a
// transposition table / ML features). Computed from public Board fields so the
// core stays unmodified.
// ----------------------------------------------------------------------------
inline uint64_t positionKey(const Board& b) {
    struct Table {
        uint64_t piece[16][64];
        uint64_t side;
        uint64_t castle[16];
        uint64_t epFile[8];
        Table() {
            uint64_t x = 0x9E3779B97F4A7C15ULL;
            auto next = [&]() {
                x += 0x9E3779B97F4A7C15ULL;
                uint64_t z = x;
                z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
                z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
                return z ^ (z >> 31);
            };
            for (auto& row : piece) for (auto& v : row) v = next();
            side = next();
            for (auto& v : castle) v = next();
            for (auto& v : epFile) v = next();
        }
    };
    static const Table T;
    uint64_t h = 0;
    for (int s = 0; s < NSQ; ++s)
        if (b.sq[s]) h ^= T.piece[b.sq[s] & 15][s];
    if (b.side == BLACK) h ^= T.side;
    h ^= T.castle[b.castling & 15];
    if (b.ep >= 0) h ^= T.epFile[colOf(b.ep)];
    return h;
}

// ----------------------------------------------------------------------------
// SAN (Standard Algebraic Notation) for a single legal move in position `b`.
// Free function so it can be reused while replaying for PGN export.
// ----------------------------------------------------------------------------
inline std::string toSan(const Board& b, const Move& m) {
    if (m.flag == F_CASTLE_K || m.flag == F_CASTLE_Q) {
        std::string s = (m.flag == F_CASTLE_K) ? "O-O" : "O-O-O";
        Board t = b; Undo u; t.makeMove(m, u);
        if (t.inCheck(t.side)) {
            MoveList r; t.generateLegal(r);
            s += (r.count == 0) ? "#" : "+";
        }
        return s;
    }

    const PType pt = pieceType(b.sq[m.from]);
    const char letters[] = {'?', 'P', 'N', 'B', 'R', 'Q', 'K'};
    std::string s;

    if (pt == PAWN) {
        if (m.isCapture()) { s += static_cast<char>('a' + colOf(m.from)); s += 'x'; }
        s += squareName(m.to);
        if (m.flag == F_PROMO || m.flag == F_PROMO_CAPTURE) {
            s += '='; s += letters[m.promo];
        }
    } else {
        s += letters[pt];
        // Disambiguate against other same-type pieces that can also reach `to`.
        MoveList legal; b.generateLegal(legal);
        bool sameFile = false, sameRank = false, ambiguous = false;
        for (int i = 0; i < legal.count; ++i) {
            const Move& o = legal.moves[i];
            if (o.to == m.to && o.from != m.from &&
                pieceType(b.sq[o.from]) == pt) {
                ambiguous = true;
                if (colOf(o.from) == colOf(m.from)) sameFile = true;
                if (rowOf(o.from) == rowOf(m.from)) sameRank = true;
            }
        }
        if (ambiguous) {
            if (!sameFile)      s += static_cast<char>('a' + colOf(m.from));
            else if (!sameRank) s += static_cast<char>('0' + (8 - rowOf(m.from)));
            else                s += squareName(m.from);
        }
        if (m.isCapture()) s += 'x';
        s += squareName(m.to);
    }

    Board t = b; Undo u; t.makeMove(m, u);
    if (t.inCheck(t.side)) {
        MoveList r; t.generateLegal(r);
        s += (r.count == 0) ? "#" : "+";
    }
    return s;
}

// ----------------------------------------------------------------------------
// Game
// ----------------------------------------------------------------------------
class Game {
public:
    Game() { reset(); }
    explicit Game(const std::string& fen) { setFen(fen); }

    // --- setup --------------------------------------------------------------
    void reset() {
        board_ = Board::startpos();
        startFen_ = board_.fen();
        resetHistory();
    }
    bool setFen(const std::string& fen) {
        if (!board_.setFromFEN(fen)) return false;
        startFen_ = fen;
        resetHistory();
        return true;
    }
    std::string fen() const { return board_.fen(); }

    // --- queries ------------------------------------------------------------
    Color        turn()  const { return board_.side; }
    const Board& board() const { return board_; }            // raw POD state
    int          ply()   const { return (int)done_.size(); } // moves played
    uint64_t     key()   const { return positionKey(board_); }

    uint8_t pieceAt(int square) const     { return board_.sq[square]; }
    uint8_t pieceAt(int row, int col) const { return board_.sq[sqOf(row, col)]; }

    std::vector<Move> legalMoves() const {
        MoveList ml; board_.generateLegal(ml);
        return std::vector<Move>(ml.begin(), ml.end());
    }
    // Legal moves originating from one square — for UI highlighting.
    std::vector<Move> legalMovesFrom(int square) const {
        MoveList ml; board_.generateLegal(ml);
        std::vector<Move> out;
        for (int i = 0; i < ml.count; ++i)
            if (ml.moves[i].from == square) out.push_back(ml.moves[i]);
        return out;
    }
    std::vector<std::string> legalUci() const {
        MoveList ml; board_.generateLegal(ml);
        std::vector<std::string> out;
        out.reserve(ml.count);
        for (int i = 0; i < ml.count; ++i) out.push_back(ml.moves[i].uci());
        return out;
    }
    bool isLegal(const Move& m) const {
        MoveList ml; board_.generateLegal(ml);
        for (int i = 0; i < ml.count; ++i) if (ml.moves[i] == m) return true;
        return false;
    }

    // --- status -------------------------------------------------------------
    bool inCheck() const { return board_.inCheck(board_.side); }
    bool hasLegalMoves() const {
        MoveList ml; board_.generateLegal(ml);
        return ml.count != 0;
    }
    bool isCheckmate()  const { return inCheck() && !hasLegalMoves(); }
    bool isStalemate()  const { return !inCheck() && !hasLegalMoves(); }
    bool isFiftyMove()  const { return board_.halfmove >= 100; }
    bool isThreefold()  const {
        uint64_t k = repetition_.back();
        int n = 0;
        for (uint64_t h : repetition_) if (h == k) ++n;
        return n >= 3;
    }
    bool isInsufficientMaterial() const {
        int minors = 0; bool bishopLight = false, bishopDark = false;
        for (int s = 0; s < NSQ; ++s) {
            uint8_t p = board_.sq[s];
            if (!p) continue;
            switch (pieceType(p)) {
                case KING: break;
                case BISHOP:
                    ++minors;
                    ((rowOf(s) + colOf(s)) & 1 ? bishopDark : bishopLight) = true;
                    break;
                case KNIGHT: ++minors; break;
                default: return false;   // pawn / rook / queen -> sufficient
            }
        }
        if (minors <= 1) return true;                       // K(K), KminorK
        if (minors == 2 && !(bishopLight && bishopDark))    // same-colour bishops
            return true;
        return false;
    }
    bool isGameOver() const {
        return isCheckmate() || isStalemate() || isFiftyMove() ||
               isThreefold() || isInsufficientMaterial();
    }
    Result result() const {
        if (isCheckmate()) return turn() == WHITE ? Result::BLACK_WINS : Result::WHITE_WINS;
        if (isStalemate() || isFiftyMove() || isThreefold() || isInsufficientMaterial())
            return Result::DRAW;
        return Result::ONGOING;
    }
    DrawReason drawReason() const {
        if (isStalemate())             return DrawReason::STALEMATE;
        if (isThreefold())             return DrawReason::THREEFOLD;
        if (isFiftyMove())             return DrawReason::FIFTY_MOVE;
        if (isInsufficientMaterial())  return DrawReason::INSUFFICIENT_MATERIAL;
        return DrawReason::NONE;
    }

    // --- playing moves ------------------------------------------------------
    bool push(const Move& m) {
        if (!isLegal(m)) return false;
        apply(m);
        redo_.clear();          // a fresh move invalidates the redo branch
        return true;
    }
    // Resolve a UCI string ("e2e4", "e7e8q") to the matching legal move.
    bool parseUci(const std::string& uci, Move& out) const {
        int from = squareFromName(uci.substr(0, 2));
        int to   = squareFromName(uci.substr(2, 2));
        if (from < 0 || to < 0) return false;
        PType promo = NO_TYPE;
        if (uci.size() >= 5) {
            switch (std::tolower(uci[4])) {
                case 'n': promo = KNIGHT; break; case 'b': promo = BISHOP; break;
                case 'r': promo = ROOK;   break; case 'q': promo = QUEEN;  break;
            }
        }
        MoveList ml; board_.generateLegal(ml);
        for (int i = 0; i < ml.count; ++i) {
            const Move& m = ml.moves[i];
            if (m.from == from && m.to == to &&
                (promo == NO_TYPE || m.promo == promo)) { out = m; return true; }
        }
        return false;
    }
    bool pushUci(const std::string& uci) {
        Move m; return parseUci(uci, m) && push(m);
    }
    std::string san(const Move& m) const { return toSan(board_, m); }

    // --- history navigation -------------------------------------------------
    bool canUndo() const { return !done_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    bool undo() {
        if (done_.empty()) return false;
        Played p = done_.back(); done_.pop_back();
        board_.unmakeMove(p.move, p.undo);
        repetition_.pop_back();
        redo_.push_back(p.move);
        return true;
    }
    bool redo() {
        if (redo_.empty()) return false;
        Move m = redo_.back(); redo_.pop_back();
        apply(m);
        return true;
    }

    std::vector<Move> history() const {
        std::vector<Move> h; h.reserve(done_.size());
        for (const auto& p : done_) h.push_back(p.move);
        return h;
    }
    std::vector<std::string> historyUci() const {
        std::vector<std::string> h; h.reserve(done_.size());
        for (const auto& p : done_) h.push_back(p.move.uci());
        return h;
    }
    // PGN movetext, e.g. "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#"
    std::string pgnMovetext() const {
        Board b; b.setFromFEN(startFen_);
        std::string out;
        bool whiteStart = (b.side == WHITE);
        int moveNo = b.fullmove;
        for (size_t i = 0; i < done_.size(); ++i) {
            bool whiteToMove = (b.side == WHITE);
            if (whiteToMove) {
                if (!out.empty()) out += ' ';
                out += std::to_string(moveNo) + ".";
            } else if (i == 0 && !whiteStart) {
                out += std::to_string(moveNo) + "...";
            }
            out += ' ';
            out += toSan(b, done_[i].move);
            Undo u; b.makeMove(done_[i].move, u);
            if (!whiteToMove) ++moveNo;
        }
        return out;
    }

private:
    struct Played { Move move; Undo undo; };

    void resetHistory() {
        done_.clear();
        redo_.clear();
        repetition_.clear();
        repetition_.push_back(positionKey(board_));
    }
    // Apply a (known-legal) move and record it, without clearing the redo stack
    // (so redo() can reuse it). push() clears redo separately.
    void apply(const Move& m) {
        Played p; p.move = m;
        board_.makeMove(m, p.undo);
        done_.push_back(p);
        repetition_.push_back(positionKey(board_));
    }

    Board board_;
    std::string startFen_;
    std::vector<Played>   done_;        // undo stack
    std::vector<Move>     redo_;        // redo stack
    std::vector<uint64_t> repetition_;  // position keys incl. start, for threefold
};

} // namespace chess
