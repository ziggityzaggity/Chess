// chess.hpp — fast, dependency-free chess core.
//
// This is a C++ re-implementation of the game logic in objects.py, redesigned
// for speed and portability:
//
//   * Board is a Plain-Old-Data struct (no shared_ptr, no heap, memcpy-able).
//     => trivially copyable per-thread / per-worker, and laid out as a flat
//        byte array so it can later be batched onto a GPU.
//   * No global mutable state and no I/O in the move generator => reentrant,
//     thread-safe by construction, and easy to embed via Emscripten (JS) and
//     pybind11 (Python).
//   * Move generation writes into a fixed-capacity list (no allocation on the
//     hot path) and uses make/unmake for search, plus a functional `applied()`
//     helper for batch / GPU-style "produce all child boards" workflows.
//
// Board orientation matches objects.py exactly so state is interchangeable with
// the Python representation:
//   row 0 = black back rank, row 1 = black pawns, row 6 = white pawns,
//   row 7 = white back rank. White pawns move "up" (toward row 0).
//
// Differences from objects.py, made for chess-correctness (both flagged here):
//   * Promotions generate all of Q/R/B/N (objects.py only promoted to queen).
//   * Castling is forbidden out of check (objects.py only blocked through/into).

#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <type_traits>

namespace chess {

// ----------------------------------------------------------------------------
// Basic types and square helpers
// ----------------------------------------------------------------------------
constexpr int BOARD = 8;
constexpr int NSQ   = 64;

enum Color : uint8_t { WHITE = 0, BLACK = 1 };

// Piece type stored in the low 3 bits of a square byte.
enum PType : uint8_t {
    NO_TYPE = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6
};

// A square byte: 0 == empty, else (color << 3) | type.  White pieces are 1..6,
// black pieces are 9..14.  Keeping a piece in one byte makes the board a flat
// 64-byte array that is cheap to copy and GPU-friendly.
inline constexpr uint8_t makePiece(Color c, PType t) {
    return static_cast<uint8_t>((c << 3) | t);
}
inline constexpr bool  isEmpty(uint8_t p)      { return p == 0; }
inline constexpr Color pieceColor(uint8_t p)   { return static_cast<Color>(p >> 3); }
inline constexpr PType pieceType(uint8_t p)    { return static_cast<PType>(p & 7); }
inline constexpr Color opp(Color c)            { return static_cast<Color>(c ^ 1); }

inline constexpr int  sqOf(int r, int c)       { return r * 8 + c; }
inline constexpr int  rowOf(int s)             { return s >> 3; }
inline constexpr int  colOf(int s)             { return s & 7; }
inline constexpr bool onBoard(int r, int c)    { return (unsigned)r < 8 && (unsigned)c < 8; }

// Castling-rights bit flags (stored in Board::castling).
enum CastleBit : uint8_t { CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8 };

// ----------------------------------------------------------------------------
// Move
// ----------------------------------------------------------------------------
enum MFlag : uint8_t {
    F_QUIET = 0, F_DOUBLE_PUSH, F_CAPTURE, F_EN_PASSANT,
    F_CASTLE_K, F_CASTLE_Q, F_PROMO, F_PROMO_CAPTURE
};

struct Move {
    uint8_t from = 0;
    uint8_t to   = 0;
    uint8_t flag = F_QUIET;
    uint8_t promo = NO_TYPE;   // promotion target PType, or NO_TYPE

    bool isCapture() const {
        return flag == F_CAPTURE || flag == F_EN_PASSANT || flag == F_PROMO_CAPTURE;
    }
    bool operator==(const Move& o) const {
        return from == o.from && to == o.to && flag == o.flag && promo == o.promo;
    }
    // Long-algebraic / UCI-style text, e.g. "e2e4", "e7e8q".
    std::string uci() const {
        auto sqStr = [](int s) {
            std::string r;
            r += static_cast<char>('a' + colOf(s));
            r += static_cast<char>('0' + (8 - rowOf(s)));
            return r;
        };
        std::string s = sqStr(from) + sqStr(to);
        if (flag == F_PROMO || flag == F_PROMO_CAPTURE) {
            const char pc[] = {'.', 'p', 'n', 'b', 'r', 'q', 'k'};
            s += pc[promo];
        }
        return s;
    }
};

// Fixed-capacity move list: no heap allocation on the hot path.  The maximum
// number of legal moves in any chess position is 218, so 256 is safe.
struct MoveList {
    static constexpr int CAP = 256;
    Move moves[CAP];
    int  count = 0;

    void add(Move m)            { moves[count++] = m; }
    void add(uint8_t f, uint8_t t, uint8_t fl, uint8_t pr = NO_TYPE) {
        moves[count++] = Move{f, t, fl, pr};
    }
    void clear()                { count = 0; }
    int  size() const           { return count; }
    const Move& operator[](int i) const { return moves[i]; }
    Move*       begin()         { return moves; }
    Move*       end()           { return moves + count; }
    const Move* begin() const   { return moves; }
    const Move* end() const     { return moves + count; }
};

// Record needed to reverse a makeMove().
struct Undo {
    uint8_t  captured = 0;   // piece byte removed (for en passant: the pawn)
    uint8_t  castling = 0;
    int8_t   ep       = -1;
    uint16_t halfmove = 0;
    uint16_t fullmove = 1;
};

// ----------------------------------------------------------------------------
// Board — the entire game state, as Plain-Old-Data.
// ----------------------------------------------------------------------------
struct Board {
    uint8_t  sq[NSQ];        // 0 == empty, else makePiece(color,type)
    Color    side;           // side to move
    uint8_t  castling;       // CR_* bits
    int8_t   ep;             // en-passant target square, or -1
    uint16_t halfmove;       // halfmove clock (50-move rule)
    uint16_t fullmove;       // full-move number

    // --- construction -------------------------------------------------------
    void clear() {
        for (int i = 0; i < NSQ; ++i) sq[i] = 0;
        side = WHITE; castling = 0; ep = -1; halfmove = 0; fullmove = 1;
    }

    static Board startpos() {
        Board b; b.clear();
        const PType back[8] = {ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK};
        for (int c = 0; c < 8; ++c) {
            b.sq[sqOf(0, c)] = makePiece(BLACK, back[c]);
            b.sq[sqOf(1, c)] = makePiece(BLACK, PAWN);
            b.sq[sqOf(6, c)] = makePiece(WHITE, PAWN);
            b.sq[sqOf(7, c)] = makePiece(WHITE, back[c]);
        }
        b.side = WHITE;
        b.castling = CR_WK | CR_WQ | CR_BK | CR_BQ;
        b.ep = -1; b.halfmove = 0; b.fullmove = 1;
        return b;
    }

    int findKing(Color c) const {
        uint8_t k = makePiece(c, KING);
        for (int s = 0; s < NSQ; ++s) if (sq[s] == k) return s;
        return -1;
    }

    // --- attack detection ---------------------------------------------------
    // True if square `s` is attacked by any piece of color `by`.
    bool isAttacked(int s, Color by) const {
        int r = rowOf(s), c = colOf(s);

        // Pawns: a white pawn attacks the two squares diagonally above it, so a
        // square is attacked by a white pawn sitting one row below (r+1).
        if (by == WHITE) {
            if (onBoard(r + 1, c - 1) && sq[sqOf(r + 1, c - 1)] == makePiece(WHITE, PAWN)) return true;
            if (onBoard(r + 1, c + 1) && sq[sqOf(r + 1, c + 1)] == makePiece(WHITE, PAWN)) return true;
        } else {
            if (onBoard(r - 1, c - 1) && sq[sqOf(r - 1, c - 1)] == makePiece(BLACK, PAWN)) return true;
            if (onBoard(r - 1, c + 1) && sq[sqOf(r - 1, c + 1)] == makePiece(BLACK, PAWN)) return true;
        }

        static constexpr int KN[8][2] = {
            {1,2},{1,-2},{-1,2},{-1,-2},{2,1},{2,-1},{-2,1},{-2,-1}};
        uint8_t kn = makePiece(by, KNIGHT);
        for (auto& o : KN)
            if (onBoard(r + o[0], c + o[1]) && sq[sqOf(r + o[0], c + o[1])] == kn) return true;

        static constexpr int KG[8][2] = {
            {-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
        uint8_t kg = makePiece(by, KING);
        for (auto& o : KG)
            if (onBoard(r + o[0], c + o[1]) && sq[sqOf(r + o[0], c + o[1])] == kg) return true;

        static constexpr int ROOK_DIR[4][2]   = {{1,0},{-1,0},{0,1},{0,-1}};
        static constexpr int BISHOP_DIR[4][2]  = {{1,1},{1,-1},{-1,1},{-1,-1}};
        for (auto& d : ROOK_DIR) {
            int rr = r + d[0], cc = c + d[1];
            while (onBoard(rr, cc)) {
                uint8_t p = sq[sqOf(rr, cc)];
                if (p) {
                    if (pieceColor(p) == by &&
                        (pieceType(p) == ROOK || pieceType(p) == QUEEN)) return true;
                    break;
                }
                rr += d[0]; cc += d[1];
            }
        }
        for (auto& d : BISHOP_DIR) {
            int rr = r + d[0], cc = c + d[1];
            while (onBoard(rr, cc)) {
                uint8_t p = sq[sqOf(rr, cc)];
                if (p) {
                    if (pieceColor(p) == by &&
                        (pieceType(p) == BISHOP || pieceType(p) == QUEEN)) return true;
                    break;
                }
                rr += d[0]; cc += d[1];
            }
        }
        return false;
    }

    bool inCheck(Color c) const { return isAttacked(findKing(c), opp(c)); }
    bool inCheck() const        { return inCheck(side); }

    // --- pseudo-legal move generation --------------------------------------
    // Generates moves that respect piece movement rules but may leave the mover
    // in check; generateLegal() filters those out.
    void generatePseudo(MoveList& out) const {
        const Color me = side, them = opp(side);
        for (int s = 0; s < NSQ; ++s) {
            uint8_t p = sq[s];
            if (!p || pieceColor(p) != me) continue;
            switch (pieceType(p)) {
                case PAWN:   genPawn(s, me, them, out);   break;
                case KNIGHT: genKnight(s, me, out);       break;
                case BISHOP: genSlider(s, me, out, true,  false); break;
                case ROOK:   genSlider(s, me, out, false, true);  break;
                case QUEEN:  genSlider(s, me, out, true,  true);  break;
                case KING:   genKing(s, me, them, out);   break;
                default: break;
            }
        }
    }

    // --- legal move generation ---------------------------------------------
    void generateLegal(MoveList& out) const {
        MoveList ps; generatePseudo(ps);
        const Color me = side;
        const int kingSq = findKing(me);
        Board tmp = *this;            // copy once; make/unmake on the copy
        Undo u;
        for (int i = 0; i < ps.count; ++i) {
            Move m = ps.moves[i];
            PType mt = pieceType(tmp.sq[m.from]);
            tmp.makeMove(m, u);
            int ks = (mt == KING) ? m.to : kingSq;   // king may have moved
            if (!tmp.isAttacked(ks, tmp.side))        // tmp.side is now the opponent
                out.moves[out.count++] = m;
            tmp.unmakeMove(m, u);
        }
    }

    // --- make / unmake ------------------------------------------------------
    void makeMove(const Move& m, Undo& u) {
        u.captured = 0;
        u.castling = castling;
        u.ep       = ep;
        u.halfmove = halfmove;
        u.fullmove = fullmove;

        const uint8_t piece = sq[m.from];
        const Color   me    = side;
        const bool    pawn  = (pieceType(piece) == PAWN);
        int newEp = -1;

        switch (m.flag) {
            case F_QUIET:
                sq[m.to] = piece; sq[m.from] = 0; break;
            case F_DOUBLE_PUSH:
                sq[m.to] = piece; sq[m.from] = 0;
                newEp = (m.from + m.to) / 2;   // square the pawn skipped over
                break;
            case F_CAPTURE:
                u.captured = sq[m.to];
                sq[m.to] = piece; sq[m.from] = 0; break;
            case F_EN_PASSANT: {
                sq[m.to] = piece; sq[m.from] = 0;
                int capSq = sqOf(rowOf(m.from), colOf(m.to));  // captured pawn
                u.captured = sq[capSq]; sq[capSq] = 0; break;
            }
            case F_CASTLE_K: {
                int row = rowOf(m.from);
                sq[m.to] = piece; sq[m.from] = 0;
                sq[sqOf(row, 5)] = sq[sqOf(row, 7)]; sq[sqOf(row, 7)] = 0; break;
            }
            case F_CASTLE_Q: {
                int row = rowOf(m.from);
                sq[m.to] = piece; sq[m.from] = 0;
                sq[sqOf(row, 3)] = sq[sqOf(row, 0)]; sq[sqOf(row, 0)] = 0; break;
            }
            case F_PROMO:
                sq[m.to] = makePiece(me, (PType)m.promo); sq[m.from] = 0; break;
            case F_PROMO_CAPTURE:
                u.captured = sq[m.to];
                sq[m.to] = makePiece(me, (PType)m.promo); sq[m.from] = 0; break;
        }

        // Castling rights: king move clears both sides; any move from/to a
        // corner clears that corner's right (rook moved, or rook captured).
        if (pieceType(piece) == KING)
            castling &= (me == WHITE) ? ~(CR_WK | CR_WQ) : ~(CR_BK | CR_BQ);
        clearCornerRight(m.from);
        clearCornerRight(m.to);

        ep       = (int8_t)newEp;
        halfmove = (pawn || u.captured) ? 0 : (uint16_t)(halfmove + 1);
        if (me == BLACK) ++fullmove;
        side = opp(me);
    }

    void unmakeMove(const Move& m, const Undo& u) {
        side = opp(side);                 // back to the mover
        const Color me = side;
        castling = u.castling;
        ep       = u.ep;
        halfmove = u.halfmove;
        fullmove = u.fullmove;

        switch (m.flag) {
            case F_QUIET:
            case F_DOUBLE_PUSH:
                sq[m.from] = sq[m.to]; sq[m.to] = 0; break;
            case F_CAPTURE:
                sq[m.from] = sq[m.to]; sq[m.to] = u.captured; break;
            case F_EN_PASSANT: {
                sq[m.from] = sq[m.to]; sq[m.to] = 0;
                int capSq = sqOf(rowOf(m.from), colOf(m.to));
                sq[capSq] = u.captured; break;
            }
            case F_CASTLE_K: {
                int row = rowOf(m.from);
                sq[m.from] = sq[m.to]; sq[m.to] = 0;
                sq[sqOf(row, 7)] = sq[sqOf(row, 5)]; sq[sqOf(row, 5)] = 0; break;
            }
            case F_CASTLE_Q: {
                int row = rowOf(m.from);
                sq[m.from] = sq[m.to]; sq[m.to] = 0;
                sq[sqOf(row, 0)] = sq[sqOf(row, 3)]; sq[sqOf(row, 3)] = 0; break;
            }
            case F_PROMO:
                sq[m.from] = makePiece(me, PAWN); sq[m.to] = 0; break;
            case F_PROMO_CAPTURE:
                sq[m.from] = makePiece(me, PAWN); sq[m.to] = u.captured; break;
        }
    }

    // Functional style for batch / GPU-style pipelines: return the child board
    // produced by `m` without mutating *this.
    Board applied(const Move& m) const {
        Board b = *this; Undo u; b.makeMove(m, u); return b;
    }

    // --- FEN ----------------------------------------------------------------
    bool setFromFEN(const std::string& fen);
    std::string fen() const;
    std::string toString() const;     // ascii board for debugging

private:
    void clearCornerRight(int s) {
        if      (s == sqOf(7, 0)) castling &= ~CR_WQ;
        else if (s == sqOf(7, 7)) castling &= ~CR_WK;
        else if (s == sqOf(0, 0)) castling &= ~CR_BQ;
        else if (s == sqOf(0, 7)) castling &= ~CR_BK;
    }

    void genStep(int from, int r, int c, Color me, MoveList& out) const {
        if (!onBoard(r, c)) return;
        int t = sqOf(r, c);
        uint8_t p = sq[t];
        if (!p)                       out.add(from, t, F_QUIET);
        else if (pieceColor(p) != me) out.add(from, t, F_CAPTURE);
    }

    void genKnight(int s, Color me, MoveList& out) const {
        static constexpr int KN[8][2] = {
            {1,2},{1,-2},{-1,2},{-1,-2},{2,1},{2,-1},{-2,1},{-2,-1}};
        int r = rowOf(s), c = colOf(s);
        for (auto& o : KN) genStep(s, r + o[0], c + o[1], me, out);
    }

    void genSlider(int s, Color me, MoveList& out, bool diag, bool orth) const {
        static constexpr int ORTH[4][2] = {{1,0},{-1,0},{0,1},{0,-1}};
        static constexpr int DIAG[4][2] = {{1,1},{1,-1},{-1,1},{-1,-1}};
        int r = rowOf(s), c = colOf(s);
        auto ray = [&](const int dir[4][2]) {
            for (int k = 0; k < 4; ++k) {
                int rr = r + dir[k][0], cc = c + dir[k][1];
                while (onBoard(rr, cc)) {
                    int t = sqOf(rr, cc);
                    uint8_t p = sq[t];
                    if (!p) out.add(s, t, F_QUIET);
                    else {
                        if (pieceColor(p) != me) out.add(s, t, F_CAPTURE);
                        break;
                    }
                    rr += dir[k][0]; cc += dir[k][1];
                }
            }
        };
        if (orth) ray(ORTH);
        if (diag) ray(DIAG);
    }

    void genKing(int s, Color me, Color them, MoveList& out) const {
        static constexpr int KG[8][2] = {
            {-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
        int r = rowOf(s), c = colOf(s);
        for (auto& o : KG) genStep(s, r + o[0], c + o[1], me, out);

        // Castling: requires the right, empty path, a rook on the corner, and
        // the king not standing in / passing through / landing on an attacked
        // square.
        const int row = (me == WHITE) ? 7 : 0;
        if (s != sqOf(row, 4)) return;            // king not on its home square
        const uint8_t myRook = makePiece(me, ROOK);
        const uint8_t kRight  = (me == WHITE) ? CR_WK : CR_BK;
        const uint8_t qRight  = (me == WHITE) ? CR_WQ : CR_BQ;

        if ((castling & kRight) && sq[sqOf(row, 7)] == myRook &&
            sq[sqOf(row, 5)] == 0 && sq[sqOf(row, 6)] == 0 &&
            !isAttacked(sqOf(row, 4), them) &&
            !isAttacked(sqOf(row, 5), them) &&
            !isAttacked(sqOf(row, 6), them))
            out.add(sqOf(row, 4), sqOf(row, 6), F_CASTLE_K);

        if ((castling & qRight) && sq[sqOf(row, 0)] == myRook &&
            sq[sqOf(row, 1)] == 0 && sq[sqOf(row, 2)] == 0 && sq[sqOf(row, 3)] == 0 &&
            !isAttacked(sqOf(row, 4), them) &&
            !isAttacked(sqOf(row, 3), them) &&
            !isAttacked(sqOf(row, 2), them))
            out.add(sqOf(row, 4), sqOf(row, 2), F_CASTLE_Q);
    }

    void genPawn(int s, Color me, Color them, MoveList& out) const {
        const int r = rowOf(s), c = colOf(s);
        const int fwd      = (me == WHITE) ? -1 : 1;   // white moves up the board
        const int startRow = (me == WHITE) ? 6 : 1;
        const int promoRow = (me == WHITE) ? 0 : 7;
        const int fr = r + fwd;

        auto addPawn = [&](int from, int to, bool capture) {
            if (rowOf(to) == promoRow) {
                uint8_t fl = capture ? F_PROMO_CAPTURE : F_PROMO;
                out.add(from, to, fl, QUEEN);
                out.add(from, to, fl, ROOK);
                out.add(from, to, fl, BISHOP);
                out.add(from, to, fl, KNIGHT);
            } else {
                out.add(from, to, capture ? F_CAPTURE : F_QUIET);
            }
        };

        // Single and double pushes.
        if (onBoard(fr, c) && sq[sqOf(fr, c)] == 0) {
            addPawn(s, sqOf(fr, c), false);
            int fr2 = r + 2 * fwd;
            if (r == startRow && sq[sqOf(fr2, c)] == 0)
                out.add(s, sqOf(fr2, c), F_DOUBLE_PUSH);
        }
        // Captures and en passant.
        for (int dc = -1; dc <= 1; dc += 2) {
            int cc = c + dc;
            if (!onBoard(fr, cc)) continue;
            int t = sqOf(fr, cc);
            uint8_t p = sq[t];
            if (p && pieceColor(p) == them)      addPawn(s, t, true);
            else if (ep >= 0 && t == ep)         out.add(s, t, F_EN_PASSANT);
        }
    }
};

static_assert(std::is_trivially_copyable<Board>::value,
              "Board must stay trivially copyable for fast copies / GPU batching");
static_assert(std::is_trivially_copyable<Move>::value, "Move must stay POD");

// ----------------------------------------------------------------------------
// perft — move-generation correctness & speed benchmark.
// ----------------------------------------------------------------------------
inline uint64_t perft(Board& b, int depth) {
    if (depth == 0) return 1;
    MoveList ml; b.generateLegal(ml);
    if (depth == 1) return (uint64_t)ml.count;
    uint64_t nodes = 0;
    Undo u;
    for (int i = 0; i < ml.count; ++i) {
        b.makeMove(ml.moves[i], u);
        nodes += perft(b, depth - 1);
        b.unmakeMove(ml.moves[i], u);
    }
    return nodes;
}

// ----------------------------------------------------------------------------
// FEN + debug printing (definitions kept inline so the core stays header-only).
// ----------------------------------------------------------------------------
inline std::string Board::toString() const {
    const char* glyph = ".PNBRQK";
    std::string out;
    for (int r = 0; r < 8; ++r) {
        for (int c = 0; c < 8; ++c) {
            uint8_t p = sq[sqOf(r, c)];
            char ch = glyph[pieceType(p)];
            if (p && pieceColor(p) == BLACK) ch = (char)(ch - 'A' + 'a');
            out += ch; out += ' ';
        }
        out += '\n';
    }
    return out;
}

inline bool Board::setFromFEN(const std::string& fen) {
    clear();
    size_t i = 0;
    int r = 0, c = 0;
    // 1. piece placement
    for (; i < fen.size() && fen[i] != ' '; ++i) {
        char ch = fen[i];
        if (ch == '/') { ++r; c = 0; continue; }
        if (ch >= '1' && ch <= '8') { c += ch - '0'; continue; }
        Color col = (ch >= 'a') ? BLACK : WHITE;
        char up = (ch >= 'a') ? (char)(ch - 'a' + 'A') : ch;
        PType t;
        switch (up) {
            case 'P': t = PAWN; break;   case 'N': t = KNIGHT; break;
            case 'B': t = BISHOP; break; case 'R': t = ROOK; break;
            case 'Q': t = QUEEN; break;  case 'K': t = KING; break;
            default: return false;
        }
        if (r > 7 || c > 7) return false;
        sq[sqOf(r, c)] = makePiece(col, t);
        ++c;
    }
    auto skipSpace = [&]{ while (i < fen.size() && fen[i] == ' ') ++i; };
    skipSpace();
    // 2. side to move
    side = (i < fen.size() && fen[i] == 'b') ? BLACK : WHITE;
    while (i < fen.size() && fen[i] != ' ') ++i;
    skipSpace();
    // 3. castling rights
    castling = 0;
    if (i < fen.size() && fen[i] == '-') { ++i; }
    else for (; i < fen.size() && fen[i] != ' '; ++i) {
        switch (fen[i]) {
            case 'K': castling |= CR_WK; break; case 'Q': castling |= CR_WQ; break;
            case 'k': castling |= CR_BK; break; case 'q': castling |= CR_BQ; break;
        }
    }
    skipSpace();
    // 4. en-passant target
    ep = -1;
    if (i < fen.size() && fen[i] != '-') {
        int file = fen[i] - 'a';
        int rank = (i + 1 < fen.size()) ? fen[i + 1] - '0' : 0;
        if (file >= 0 && file < 8 && rank >= 1 && rank <= 8)
            ep = (int8_t)sqOf(8 - rank, file);
        i += 2;
    } else { ++i; }
    skipSpace();
    // 5. halfmove clock, 6. fullmove number (optional)
    halfmove = 0; fullmove = 1;
    if (i < fen.size()) {
        int v = 0; bool any = false;
        for (; i < fen.size() && fen[i] >= '0' && fen[i] <= '9'; ++i) { v = v * 10 + (fen[i]-'0'); any = true; }
        if (any) halfmove = (uint16_t)v;
        skipSpace();
        v = 0; any = false;
        for (; i < fen.size() && fen[i] >= '0' && fen[i] <= '9'; ++i) { v = v * 10 + (fen[i]-'0'); any = true; }
        if (any) fullmove = (uint16_t)v;
    }
    return true;
}

inline std::string Board::fen() const {
    const char* glyph = ".PNBRQK";
    std::string out;
    for (int r = 0; r < 8; ++r) {
        int empty = 0;
        for (int c = 0; c < 8; ++c) {
            uint8_t p = sq[sqOf(r, c)];
            if (!p) { ++empty; continue; }
            if (empty) { out += (char)('0' + empty); empty = 0; }
            char ch = glyph[pieceType(p)];
            if (pieceColor(p) == BLACK) ch = (char)(ch - 'A' + 'a');
            out += ch;
        }
        if (empty) out += (char)('0' + empty);
        if (r != 7) out += '/';
    }
    out += ' ';
    out += (side == WHITE) ? 'w' : 'b';
    out += ' ';
    if (!castling) out += '-';
    else {
        if (castling & CR_WK) out += 'K';
        if (castling & CR_WQ) out += 'Q';
        if (castling & CR_BK) out += 'k';
        if (castling & CR_BQ) out += 'q';
    }
    out += ' ';
    if (ep < 0) out += '-';
    else { out += (char)('a' + colOf(ep)); out += (char)('0' + (8 - rowOf(ep))); }
    out += ' ';
    out += std::to_string(halfmove);
    out += ' ';
    out += std::to_string(fullmove);
    return out;
}

} // namespace chess
