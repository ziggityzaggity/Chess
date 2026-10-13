// chess_web.cpp — Emscripten/embind interface for the chess core.
//
// This is a thin, GUI-oriented facade over chess::Game. It deliberately does
// NOT expose engine internals (Move structs, MoveList, enums) across the JS
// boundary. Instead it speaks in the terms a board UI actually needs:
//
//   * boardString()  — a 64-char snapshot, fetched once per position change
//                      (not per frame), so rendering stays cheap.
//   * movesFrom(sq)  — target squares for the selected piece (highlighting),
//                      with promotion duplicates collapsed to one square.
//   * doMove(...)    — one boundary crossing that returns everything the UI
//                      needs to react: SAN, capture/castle/promotion/en-passant
//                      flags, check, game-over and result, plus the new board.
//
// Squares are 0..63, row-major, row 0 = top (black's back rank) — same as the
// core. Build flags live in bindings/web/CMakeLists.txt.
//
// The bots (web/src/lib/search.ts) search on compact positions: 72-byte
// chess::Board rows packed in a Uint8Array, as in the Python package.
//
//   * game.rootChildren()  — every legal move of the current position with the
//                            position it leads to (rules, repetition, material).
//   * expandBoards(bytes)  — the same for a batch of compact positions.
//   * encodeBoards(bytes)  — network input planes (core/encode.hpp), exactly
//                            what the value network was trained on.

#include "game.hpp"
#include "encode.hpp"
#include <cstring>
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace emscripten;
using namespace chess;

namespace {

// Copies of C++ buffers as JS typed arrays (the views would dangle).
template <typename T>
val toTyped(const char* type, const std::vector<T>& v) {
    return val::global(type).new_(typed_memory_view(v.size(), v.data()));
}

std::vector<Board> boardsFromBytes(const val& bytes) {
    const std::vector<uint8_t> raw = convertJSArrayToNumberVector<uint8_t>(bytes);
    std::vector<Board> boards(raw.size() / sizeof(Board));
    if (!boards.empty()) std::memcpy(boards.data(), raw.data(), boards.size() * sizeof(Board));
    return boards;
}

// The Greedy bot's evaluation, for the side to move: material (P 1, N 3, B 3,
// R 5, Q 9) minus the opponent's, and 0.4 worse when in check.
float materialScore(const Board& b) {
    static constexpr float VALUE[7] = {0, 1, 3, 3, 5, 9, 0};
    const int us = sideToMove(b) == WHITE ? 0 : 1;
    float score = 0;
    for (int i = 0; i < 64; ++i) {
        const uint8_t p = b.sq[i];
        if (!validPiece(p)) continue;
        score += ((p >> 3) == us ? 1.0f : -1.0f) * VALUE[p & 7];
    }
    return b.inCheck() ? score - 0.4f : score;
}

// Children of each board: {boards (72 bytes each), status (Status codes, for the
// side to move in the child), material (materialScore of the child),
// offsets (board i's children are offsets[i]..offsets[i + 1])}.
val expandBoards(const val& bytes) {
    const std::vector<Board> boards = boardsFromBytes(bytes);
    std::vector<Board> children;
    std::vector<uint8_t> status;
    std::vector<float> material;
    std::vector<int32_t> offsets{0};
    children.reserve(boards.size() * 40);
    for (const Board& b : boards) {
        b.forEachLegal([&](const Move&, const Board& child) {
            uint8_t st;
            countAndStatus(child, &st);
            children.push_back(child);
            status.push_back(st);
            material.push_back(materialScore(child));
        });
        offsets.push_back((int32_t)children.size());
    }
    std::vector<uint8_t> raw(children.size() * sizeof(Board));
    if (!raw.empty()) std::memcpy(raw.data(), children.data(), raw.size());
    val r = val::object();
    r.set("boards", toTyped("Uint8Array", raw));
    r.set("status", toTyped("Uint8Array", status));
    r.set("material", toTyped("Float32Array", material));
    r.set("offsets", toTyped("Int32Array", offsets));
    return r;
}

// Network input for each board: NUM_PLANES x 8 x 8 floats per board.
val encodeBoards(const val& bytes) {
    const std::vector<Board> boards = boardsFromBytes(bytes);
    std::vector<float> out(boards.size() * ENCODED_FLOATS);
    for (size_t i = 0; i < boards.size(); ++i) encodeBoard(boards[i], &out[i * ENCODED_FLOATS]);
    return toTyped("Float32Array", out);
}

} // namespace

class WebGame {
public:
    WebGame() { game_.reset(); }

    // --- setup --------------------------------------------------------------
    void reset()                          { game_.reset(); }
    bool setFen(const std::string& fen)   { return game_.setFen(fen); }
    std::string fen() const               { return game_.fen(); }

    // --- rendering ----------------------------------------------------------
    // 64 chars, row-major: '.' empty, white = PNBRQK, black = pnbrqk.
    std::string boardString() const {
        std::string s(64, '.');
        for (int i = 0; i < 64; ++i) s[i] = pieceGlyph(game_.pieceAt(i));
        return s;
    }
    int  turn()    const { return (int)game_.turn(); }   // 0 = white, 1 = black
    bool inCheck() const { return game_.inCheck(); }
    int  ply()     const { return game_.ply(); }
    int  kingSquare(int color) const {
        return game_.board().findKing(color == 0 ? WHITE : BLACK);
    }

    // --- move input ---------------------------------------------------------
    // Target squares reachable from `square` (promotions collapse to one entry).
    val movesFrom(int square) const {
        val arr = val::array();
        bool seen[64] = {false};
        int k = 0;
        for (const Move& m : game_.legalMovesFrom(square)) {
            if (seen[m.to]) continue;
            seen[m.to] = true;
            arr.set(k++, (int)m.to);
        }
        return arr;
    }
    bool isPromotion(int from, int to) const {
        for (const Move& m : game_.legalMovesFrom(from))
            if (m.to == to && (m.flag == F_PROMO || m.flag == F_PROMO_CAPTURE))
                return true;
        return false;
    }

    // Play from->to. `promo` is "", "q", "r", "b" or "n". Returns an object the
    // UI can act on in one call.
    val doMove(int from, int to, std::string promo) {
        val r = val::object();
        std::string uci = squareName(from) + squareName(to);
        if (!promo.empty()) uci += promo[0];

        Move m;
        if (!game_.parseUci(uci, m)) { r.set("ok", false); return r; }

        const std::string san = game_.san(m);   // SAN must be computed pre-move
        const bool capture   = m.isCapture();
        const bool castle    = (m.flag == F_CASTLE_K || m.flag == F_CASTLE_Q);
        const bool promotion = (m.flag == F_PROMO || m.flag == F_PROMO_CAPTURE);
        const bool enpassant = (m.flag == F_EN_PASSANT);

        game_.push(m);

        r.set("ok", true);
        r.set("from", from);
        r.set("to", to);
        r.set("san", san);
        r.set("capture", capture);
        r.set("castle", castle);
        r.set("promotion", promotion);
        r.set("enpassant", enpassant);
        r.set("check", game_.inCheck());
        r.set("checkmate", game_.isCheckmate());
        r.set("gameOver", game_.isGameOver());
        r.set("result", (int)game_.result());        // 0 ongoing,1 W,2 B,3 draw
        r.set("drawReason", (int)game_.drawReason());
        r.set("board", boardString());
        return r;
    }

    // --- history ------------------------------------------------------------
    bool undo()         { return game_.undo(); }
    bool redo()         { return game_.redo(); }
    bool canUndo() const { return game_.canUndo(); }
    bool canRedo() const { return game_.canRedo(); }
    std::string lastMoveUci() const {
        auto h = game_.historyUci();
        return h.empty() ? std::string() : h.back();
    }

    // --- status -------------------------------------------------------------
    bool isGameOver()  const { return game_.isGameOver(); }
    bool isCheckmate() const { return game_.isCheckmate(); }
    int  result()      const { return (int)game_.result(); }
    int  drawReason()  const { return (int)game_.drawReason(); }
    std::string pgn()  const { return game_.pgnMovetext(); }

    // Full legal move list as UCI strings — handy for an AI hook or debugging.
    val legalUci() const {
        val a = val::array();
        auto v = game_.legalUci();
        for (size_t i = 0; i < v.size(); ++i) a.set((int)i, v[i]);
        return a;
    }

    // --- search -------------------------------------------------------------
    // The current position as one compact board (72 bytes).
    val compactBoard() const {
        std::vector<uint8_t> raw(sizeof(Board));
        std::memcpy(raw.data(), &game_.board(), sizeof(Board));
        return toTyped("Uint8Array", raw);
    }

    // Every legal move with the position it leads to: {moves (UCI strings),
    // boards, status, material} as in expandBoards, plus repetition[i] = 1 if
    // move i repeats a position for the third time (a draw the compact boards
    // cannot see). The game itself is not modified.
    val rootChildren() const {
        Game probe = game_;
        val moves = val::array();
        std::vector<Board> children;
        std::vector<uint8_t> status, repetition;
        std::vector<float> material;
        game_.board().forEachLegal([&](const Move& m, const Board& child) {
            uint8_t st;
            countAndStatus(child, &st);
            probe.push(m);
            repetition.push_back(probe.isThreefold() ? 1 : 0);
            probe.undo();
            moves.set((int)children.size(), m.uci());
            children.push_back(child);
            status.push_back(st);
            material.push_back(materialScore(child));
        });
        std::vector<uint8_t> raw(children.size() * sizeof(Board));
        if (!raw.empty()) std::memcpy(raw.data(), children.data(), raw.size());
        val r = val::object();
        r.set("moves", moves);
        r.set("boards", toTyped("Uint8Array", raw));
        r.set("status", toTyped("Uint8Array", status));
        r.set("material", toTyped("Float32Array", material));
        r.set("repetition", toTyped("Uint8Array", repetition));
        return r;
    }

private:
    Game game_;
};

EMSCRIPTEN_BINDINGS(chess_module) {
    class_<WebGame>("ChessGame")
        .constructor<>()
        .function("reset",       &WebGame::reset)
        .function("setFen",      &WebGame::setFen)
        .function("fen",         &WebGame::fen)
        .function("boardString", &WebGame::boardString)
        .function("turn",        &WebGame::turn)
        .function("inCheck",     &WebGame::inCheck)
        .function("ply",         &WebGame::ply)
        .function("kingSquare",  &WebGame::kingSquare)
        .function("movesFrom",   &WebGame::movesFrom)
        .function("isPromotion", &WebGame::isPromotion)
        .function("doMove",      &WebGame::doMove)
        .function("undo",        &WebGame::undo)
        .function("redo",        &WebGame::redo)
        .function("canUndo",     &WebGame::canUndo)
        .function("canRedo",     &WebGame::canRedo)
        .function("lastMoveUci", &WebGame::lastMoveUci)
        .function("isGameOver",  &WebGame::isGameOver)
        .function("isCheckmate", &WebGame::isCheckmate)
        .function("result",      &WebGame::result)
        .function("drawReason",  &WebGame::drawReason)
        .function("pgn",         &WebGame::pgn)
        .function("legalUci",    &WebGame::legalUci)
        .function("compactBoard", &WebGame::compactBoard)
        .function("rootChildren", &WebGame::rootChildren)
        ;
    function("expandBoards", &expandBoards);
    function("encodeBoards", &encodeBoards);
    constant("BOARD_BYTES", BOARD_BYTES);
    constant("NUM_PLANES", NUM_PLANES);
}
