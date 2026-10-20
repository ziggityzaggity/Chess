// encode.hpp — neural-network input encoding and per-position status.
//
// This file is the single definition of what the value network sees. The CPU
// batch code (batch.hpp), the CUDA kernels (gpu/chess_cuda.cu) and the Python
// bindings all call these functions, so training and inference can never
// disagree about the encoding.
//
// Encoding: 19 planes of 8x8, from the perspective of the side to move ("us").
// When black is to move the board is flipped vertically (rank r -> 9 - r) and
// the colours are swapped, so the model always sees its own pieces moving up
// the board. Chess is symmetric under that transform, so this halves what the
// model has to learn, and the prediction is simply "how does this go for the
// player to move". Files are not mirrored, so the king side stays on the right.
//
//   planes 0-5    our   P N B R Q K   one-hot: 1.0 where that piece stands
//   planes 6-11   their P N B R Q K
//   plane  12     we may castle king side      (constant plane, 0.0 or 1.0)
//   plane  13     we may castle queen side
//   plane  14     they may castle king side
//   plane  15     they may castle queen side
//   plane  16     en-passant target square     (one-hot, all zero if none)
//   plane  17     half-move clock / 100        (constant, clipped to [0, 1])
//   plane  18     all ones                     (marks the board inside zero
//                                               padding for the convolutions)
//
// The heuristic encoding (HEURISTIC_PLANES = 23, used by the Deep Q models)
// appends four hand-made features about the position's tactics:
//
//   plane  19     our attacks on each square    (attacker count / 4, max 1)
//   plane  20     their attacks on each square
//   plane  21     our pieces in danger          (1.0 on the piece's square)
//   plane  22     their pieces in danger
//
// A piece is "in danger" when the other side attacks it and either nothing
// defends it or its cheapest attacker is worth less than it (a pawn attacking
// a knight). A king in check is in danger. Attacks are pseudo-legal: pins and
// x-rays are ignored, which is what makes the features cheap. Centre control
// is not a separate plane: the network reads it from planes 19-20 on d4, e4,
// d5 and e5.
//
// Piece identity is categorical, so it is one-hot encoded: 12 binary planes,
// never one "piece code" number (a code of 5 for a queen and 6 for a king
// would falsely tell the model a king is "more" than a queen). "Empty" is the
// all-zero case, the usual drop-one encoding. Castling rights are 4
// independent yes/no facts, so they get 4 binary planes. The only numeric
// input, the half-move clock, is scaled into [0, 1] like the other inputs.
//
// View squares use the core's convention: index = row * 8 + col, row 0 at the
// top. In the model's view, "our" back rank is row 7 and our pawns move
// towards row 0.

#pragma once
#include "chess.hpp"
#include <cstddef>

namespace chess {

// ----------------------------------------------------------------------------
// Board memory layout — a public contract for batching. Python views an
// (N, 72) uint8 array as N Boards; CUDA copies it as 9 eight-byte words.
// ----------------------------------------------------------------------------
constexpr int BOARD_BYTES = 72;
static_assert(sizeof(Board) == BOARD_BYTES, "Board layout changed: update Python dtype");
static_assert(alignof(Board) == 8, "Board must stay 8-byte aligned");
static_assert(offsetof(Board, sq)       == 0,  "Board layout changed");
static_assert(offsetof(Board, side)     == 64, "Board layout changed");
static_assert(offsetof(Board, castling) == 65, "Board layout changed");
static_assert(offsetof(Board, ep)       == 66, "Board layout changed");
static_assert(offsetof(Board, reserved) == 67, "Board layout changed");
static_assert(offsetof(Board, halfmove) == 68, "Board layout changed");
static_assert(offsetof(Board, fullmove) == 70, "Board layout changed");
static_assert(sizeof(Move) == 4, "Move must stay 4 bytes: (from, to, flag, promo)");

// ----------------------------------------------------------------------------
// Planes
// ----------------------------------------------------------------------------
constexpr int NUM_PLANES = 19;                // the standard encoding
constexpr int HEURISTIC_PLANES = 23;          // plus the four heuristic planes
constexpr int PLANE_SIZE = 64;
constexpr int ENCODED_FLOATS = NUM_PLANES * PLANE_SIZE;   // floats per position
constexpr int HEURISTIC_FLOATS = HEURISTIC_PLANES * PLANE_SIZE;

// The encodings a caller may ask for, by plane count.
CHESS_HD inline constexpr bool validPlaneCount(int planes) {
    return planes == NUM_PLANES || planes == HEURISTIC_PLANES;
}

enum Plane : int {
    PL_OUR_PIECES   = 0,    // + (type - 1): P=0 .. K=5
    PL_THEIR_PIECES = 6,    // + (type - 1)
    PL_OUR_OO       = 12,
    PL_OUR_OOO      = 13,
    PL_THEIR_OO     = 14,
    PL_THEIR_OOO    = 15,
    PL_EP           = 16,
    PL_HALFMOVE     = 17,
    PL_ONES         = 18,
    PL_OUR_ATTACKS    = 19,
    PL_THEIR_ATTACKS  = 20,
    PL_OUR_DANGER     = 21,
    PL_THEIR_DANGER   = 22,
};

inline const char* planeName(int p) {
    static const char* names[HEURISTIC_PLANES] = {
        "our_pawn", "our_knight", "our_bishop", "our_rook", "our_queen", "our_king",
        "their_pawn", "their_knight", "their_bishop", "their_rook", "their_queen", "their_king",
        "our_castle_kingside", "our_castle_queenside",
        "their_castle_kingside", "their_castle_queenside",
        "en_passant", "halfmove_clock", "ones",
        "our_attacks", "their_attacks", "our_pieces_in_danger", "their_pieces_in_danger",
    };
    return (p >= 0 && p < HEURISTIC_PLANES) ? names[p] : "";
}

// The side to move, normalised: raw bytes from Python may hold any value in
// `side`, and every encoder (CPU, CUDA, PyTorch) reads non-zero as black.
CHESS_HD inline Color sideToMove(const Board& b) { return b.side == WHITE ? WHITE : BLACK; }

// Board square shown at view square `v` (the flip is its own inverse, so this
// also maps a board square to its view square).
CHESS_HD inline int viewToBoard(int v, Color us) { return us == WHITE ? v : (v ^ 56); }

// Boards may arrive as raw bytes from Python; bytes that are not a piece
// (type 0 or 7) are treated as empty so they can never index outside a plane.
CHESS_HD inline bool validPiece(uint8_t p) {
    return pieceType(p) >= PAWN && pieceType(p) <= KING && p < 16;
}

CHESS_HD inline float halfmoveFeature(const Board& b) {
    return (b.halfmove >= 100 ? 100 : b.halfmove) / 100.0f;
}

CHESS_HD inline bool castleRight(const Board& b, Color who, bool kingSide) {
    const uint8_t bit = (who == WHITE) ? (kingSide ? CR_WK : CR_WQ)
                                       : (kingSide ? CR_BK : CR_BQ);
    return (b.castling & bit) != 0;
}

// ----------------------------------------------------------------------------
// Heuristic features (planes 19-22)
// ----------------------------------------------------------------------------
// Piece values for "in danger": P N B R Q = 1 3 3 5 9; a king is worth more
// than anything, so any attack on it counts.
CHESS_HD inline int heuristicValue(int type) {
    switch (type) {
        case PAWN: return 1;   case KNIGHT: return 3; case BISHOP: return 3;
        case ROOK: return 5;   case QUEEN: return 9;  case KING: return 100;
        default:   return 0;
    }
}

struct AttackInfo {
    int count;      // pieces of the attacking colour that attack the square
    int cheapest;   // heuristicValue() of the least valuable of them; 0 if none
};

// Who of colour `by` attacks square `s` (pseudo-legal: pins and x-rays are
// ignored). The same scan as Board::isAttacked, but counting every attacker.
CHESS_HD inline AttackInfo attackInfo(const Board& b, int s, Color by) {
    AttackInfo a{0, 0};
    auto add = [&](uint8_t p) {
        const int v = heuristicValue(pieceType(p));
        ++a.count;
        if (a.cheapest == 0 || v < a.cheapest) a.cheapest = v;
    };
    const int r = rowOf(s), c = colOf(s);
    const int pr = by == WHITE ? r + 1 : r - 1;          // the row an attacking pawn stands on
    const uint8_t pawn = makePiece(by, PAWN);
    if (onBoard(pr, c - 1) && b.sq[sqOf(pr, c - 1)] == pawn) add(pawn);
    if (onBoard(pr, c + 1) && b.sq[sqOf(pr, c + 1)] == pawn) add(pawn);
    const uint8_t kn = makePiece(by, KNIGHT), kg = makePiece(by, KING);
    for (int k = 0; k < 8; ++k) {
        const Step o = knightStep(k);
        if (onBoard(r + o.dr, c + o.dc) && b.sq[sqOf(r + o.dr, c + o.dc)] == kn) add(kn);
        const Step q = kingStep(k);
        if (onBoard(r + q.dr, c + q.dc) && b.sq[sqOf(r + q.dr, c + q.dc)] == kg) add(kg);
    }
    for (int k = 0; k < 8; ++k) {
        const bool diag = k >= 4;
        const Step d = diag ? diagStep(k - 4) : orthStep(k);
        int rr = r + d.dr, cc = c + d.dc;
        while (onBoard(rr, cc)) {
            const uint8_t p = b.sq[sqOf(rr, cc)];
            if (p) {
                const int t = pieceType(p);
                if (validPiece(p) && pieceColor(p) == by &&
                    (t == QUEEN || t == (diag ? BISHOP : ROOK))) add(p);
                break;
            }
            rr += d.dr; cc += d.dc;
        }
    }
    return a;
}

CHESS_HD inline float attackFeature(int count) { return (count >= 4 ? 4 : count) / 4.0f; }

// 1.0 if the piece on board square `s` is in danger (see the header comment).
CHESS_HD inline float dangerFeature(const Board& b, int s) {
    const uint8_t p = b.sq[s];
    if (!validPiece(p)) return 0.0f;
    const Color owner = pieceColor(p);
    const AttackInfo att = attackInfo(b, s, opp(owner));
    if (att.count == 0) return 0.0f;
    if (att.cheapest < heuristicValue(pieceType(p))) return 1.0f;
    return attackInfo(b, s, owner).count == 0 ? 1.0f : 0.0f;
}

// One element of the encoding: the value of `plane` at view square `v`. The
// CUDA encoder runs one thread per element, so writes are fully coalesced.
CHESS_HD inline float planeValue(const Board& b, int plane, int v) {
    const Color us = sideToMove(b);
    const int s = viewToBoard(v, us);
    if (plane < 12) {
        const uint8_t p = b.sq[s];
        if (!validPiece(p)) return 0.0f;
        const int idx = (pieceColor(p) == us ? PL_OUR_PIECES : PL_THEIR_PIECES)
                        + pieceType(p) - 1;
        return idx == plane ? 1.0f : 0.0f;
    }
    switch (plane) {
        case PL_OUR_OO:    return castleRight(b, us, true)        ? 1.0f : 0.0f;
        case PL_OUR_OOO:   return castleRight(b, us, false)       ? 1.0f : 0.0f;
        case PL_THEIR_OO:  return castleRight(b, opp(us), true)   ? 1.0f : 0.0f;
        case PL_THEIR_OOO: return castleRight(b, opp(us), false)  ? 1.0f : 0.0f;
        case PL_EP:        return (b.ep >= 0 && s == b.ep)        ? 1.0f : 0.0f;
        case PL_HALFMOVE:  return halfmoveFeature(b);
        case PL_ONES:      return 1.0f;
        case PL_OUR_ATTACKS:   return attackFeature(attackInfo(b, s, us).count);
        case PL_THEIR_ATTACKS: return attackFeature(attackInfo(b, s, opp(us)).count);
        case PL_OUR_DANGER:
        case PL_THEIR_DANGER: {
            const uint8_t p = b.sq[s];
            if (!validPiece(p) || (pieceColor(p) == us) != (plane == PL_OUR_DANGER)) return 0.0f;
            return dangerFeature(b, s);
        }
        default:           return 0.0f;
    }
}

// Whole-position encoder: writes planes * 64 floats (planes = NUM_PLANES or
// HEURISTIC_PLANES), plane-major (out[plane * 64 + view_square]). Equivalent
// to calling planeValue() for every element, but touches only occupied
// squares where it can — the fast CPU path.
CHESS_HD inline void encodeBoard(const Board& b, float* out, int planes = NUM_PLANES) {
    const Color us = sideToMove(b);
    for (int i = 0; i < planes * PLANE_SIZE; ++i) out[i] = 0.0f;
    for (int s = 0; s < NSQ; ++s) {
        const uint8_t p = b.sq[s];
        if (!validPiece(p)) continue;
        const int plane = (pieceColor(p) == us ? PL_OUR_PIECES : PL_THEIR_PIECES)
                          + pieceType(p) - 1;
        out[plane * PLANE_SIZE + viewToBoard(s, us)] = 1.0f;
    }
    auto fill = [&](int plane, float v) {
        for (int i = 0; i < PLANE_SIZE; ++i) out[plane * PLANE_SIZE + i] = v;
    };
    if (castleRight(b, us, true))       fill(PL_OUR_OO, 1.0f);
    if (castleRight(b, us, false))      fill(PL_OUR_OOO, 1.0f);
    if (castleRight(b, opp(us), true))  fill(PL_THEIR_OO, 1.0f);
    if (castleRight(b, opp(us), false)) fill(PL_THEIR_OOO, 1.0f);
    if (b.ep >= 0 && b.ep < NSQ) out[PL_EP * PLANE_SIZE + viewToBoard(b.ep, us)] = 1.0f;
    fill(PL_HALFMOVE, halfmoveFeature(b));
    fill(PL_ONES, 1.0f);
    if (planes < HEURISTIC_PLANES) return;
    for (int s = 0; s < NSQ; ++s) {
        const int v = viewToBoard(s, us);
        out[PL_OUR_ATTACKS * PLANE_SIZE + v]   = attackFeature(attackInfo(b, s, us).count);
        out[PL_THEIR_ATTACKS * PLANE_SIZE + v] = attackFeature(attackInfo(b, s, opp(us)).count);
        const uint8_t p = b.sq[s];
        if (!validPiece(p)) continue;
        const int plane = pieceColor(p) == us ? PL_OUR_DANGER : PL_THEIR_DANGER;
        out[plane * PLANE_SIZE + v] = dangerFeature(b, s);
    }
}

// ----------------------------------------------------------------------------
// Terminal status of a single position (no history, so no threefold
// repetition; chess::Game tracks that). Checkmate outranks the 50-move rule.
// ----------------------------------------------------------------------------
enum Status : uint8_t {
    ST_ONGOING = 0,
    ST_CHECKMATE = 1,              // side to move is mated (a loss for it)
    ST_STALEMATE = 2,
    ST_INSUFFICIENT_MATERIAL = 3,
    ST_FIFTY_MOVE = 4,
};

CHESS_HD inline uint8_t boardStatus(const Board& b, int legalMoves) {
    if (legalMoves == 0) return b.inCheck() ? ST_CHECKMATE : ST_STALEMATE;
    if (b.insufficientMaterial()) return ST_INSUFFICIENT_MATERIAL;
    if (b.halfmove >= 100) return ST_FIFTY_MOVE;
    return ST_ONGOING;
}

// ----------------------------------------------------------------------------
// Per-board batch primitives shared by the CPU (batch.hpp) and CUDA kernels.
// ----------------------------------------------------------------------------
CHESS_HD inline int countAndStatus(const Board& b, uint8_t* status) {
    const int n = b.countLegal();
    if (status) *status = boardStatus(b, n);
    return n;
}

// Writes every legal child position (and optionally its move and parent
// index) starting at the given output slots; returns the number written.
CHESS_HD inline int expandBoard(const Board& b, Board* children, Move* moves,
                                int64_t* parent, int64_t parentIndex) {
    int k = 0;
    b.forEachLegal([&](const Move& m, const Board& child) {
        if (children) children[k] = child;
        if (moves)    moves[k] = m;
        if (parent)   parent[k] = parentIndex;
        ++k;
    });
    return k;
}

} // namespace chess
