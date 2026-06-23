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

#include "game.hpp"
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace emscripten;
using namespace chess;

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
        ;
}
