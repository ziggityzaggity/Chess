// game_demo.cpp — exercises the Game wrapper (status, history, SAN, draws).
//
// Build: g++ -O3 -std=c++17 core/game_demo.cpp -o core/game_demo
// Run:   core/game_demo

#include "game.hpp"
#include <cstdio>

using namespace chess;

static int failures = 0;
#define CHECK(cond) do { \
    if (cond) printf("  ok   %s\n", #cond); \
    else { printf("  FAIL %s\n", #cond); ++failures; } \
} while (0)

int main() {
    printf("[startpos]\n");
    {
        Game g;
        CHECK(g.legalMoves().size() == 20);
        CHECK(g.turn() == WHITE);
        CHECK(!g.isGameOver());
    }

    printf("[scholar's mate -> checkmate, SAN, result]\n");
    {
        Game g;
        const char* moves[] = {"e2e4","e7e5","f1c4","b8c6","d1h5","g8f6"};
        for (auto mv : moves) CHECK(g.pushUci(mv));

        Move mate;
        CHECK(g.parseUci("h5f7", mate));
        CHECK(g.san(mate) == "Qxf7#");
        CHECK(g.push(mate));
        CHECK(g.isCheckmate());
        CHECK(g.isGameOver());
        CHECK(g.result() == Result::WHITE_WINS);
        printf("  PGN: %s\n", g.pgnMovetext().c_str());

        // Undo the mate, confirm it's no longer over, then redo.
        CHECK(g.undo());
        CHECK(!g.isGameOver());
        CHECK(g.canRedo());
        CHECK(g.redo());
        CHECK(g.isCheckmate());
    }

    printf("[undo/redo round-trips FEN]\n");
    {
        Game g;
        std::string start = g.fen();
        CHECK(g.pushUci("e2e4"));
        CHECK(g.fen() != start);
        CHECK(g.undo());
        CHECK(g.fen() == start);
        CHECK(g.redo());
        CHECK(g.fen() != start);
        // A new move after undo must drop the redo branch.
        CHECK(g.undo());
        CHECK(g.pushUci("d2d4"));
        CHECK(!g.canRedo());
    }

    printf("[stalemate]\n");
    {
        Game g("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
        CHECK(!g.inCheck());
        CHECK(g.isStalemate());
        CHECK(g.result() == Result::DRAW);
        CHECK(g.drawReason() == DrawReason::STALEMATE);
    }

    printf("[insufficient material]\n");
    {
        Game g("8/8/4k3/8/8/3K4/8/8 w - - 0 1");          // K vs K
        CHECK(g.isInsufficientMaterial());
        CHECK(g.result() == Result::DRAW);
        Game g2("8/8/4k3/8/8/3K1B2/8/8 w - - 0 1");        // K+B vs K
        CHECK(g2.isInsufficientMaterial());
        Game g3("8/8/4k3/8/8/3K1R2/8/8 w - - 0 1");        // K+R vs K -> sufficient
        CHECK(!g3.isInsufficientMaterial());
        Game g4("8/8/4k3/8/8/3K1N2/8/8 w - - 0 1");        // K+N vs K -> draw
        CHECK(g4.isInsufficientMaterial());
        // K+B+N vs K is a forced WIN — must never be flagged insufficient.
        Game g5("8/8/8/4k3/8/8/8/2NBK3 w - - 0 1");
        CHECK(!g5.isInsufficientMaterial());
        // K+N+N vs K: mate remains possible, so not a dead position.
        Game g6("8/8/8/4k3/8/8/8/1N1NK3 w - - 0 1");
        CHECK(!g6.isInsufficientMaterial());
        // Same-colour bishops (c1,e1 are both dark) cannot mate -> draw.
        Game g7("8/8/8/4k3/8/8/8/2B1BK2 w - - 0 1");
        CHECK(g7.isInsufficientMaterial());
        // Opposite-colour bishops (c1 dark, f1 light) can mate -> sufficient.
        Game g8("8/8/8/4k3/8/8/8/2B2BK1 w - - 0 1");
        CHECK(!g8.isInsufficientMaterial());
    }

    printf("[castling moves the king and the rook]\n");
    {
        // White O-O: king e1->g1, rook h1->f1.
        Game wk("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
        Move m;
        CHECK(wk.parseUci("e1g1", m) && wk.san(m) == "O-O" && wk.push(m));
        CHECK(pieceGlyph(wk.pieceAt(sqOf(7, 6))) == 'K');   // king on g1
        CHECK(pieceGlyph(wk.pieceAt(sqOf(7, 5))) == 'R');   // rook on f1
        CHECK(wk.pieceAt(sqOf(7, 4)) == 0);                 // e1 empty
        CHECK(wk.undo());                                   // unmake restores both
        CHECK(pieceGlyph(wk.pieceAt(sqOf(7, 4))) == 'K');
        CHECK(pieceGlyph(wk.pieceAt(sqOf(7, 7))) == 'R');

        // Black O-O-O: king e8->c8, rook a8->d8.
        Game bq("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
        CHECK(bq.parseUci("e8c8", m) && bq.san(m) == "O-O-O" && bq.push(m));
        CHECK(pieceGlyph(bq.pieceAt(sqOf(0, 2))) == 'k');   // king on c8
        CHECK(pieceGlyph(bq.pieceAt(sqOf(0, 3))) == 'r');   // rook on d8
    }

    printf("[threefold repetition]\n");
    {
        Game g;
        const char* shuffle[] = {"g1f3","g8f6","f3g1","f6g8",
                                 "g1f3","g8f6","f3g1","f6g8"};
        for (auto mv : shuffle) CHECK(g.pushUci(mv));
        CHECK(g.isThreefold());
        CHECK(g.result() == Result::DRAW);
        CHECK(g.drawReason() == DrawReason::THREEFOLD);
    }

    printf("[promotion SAN + legalMovesFrom]\n");
    {
        Game g("8/P7/8/8/8/8/8/k6K w - - 0 1");           // white pawn a7 -> a8
        auto from = g.legalMovesFrom(sqOf(1, 0));          // a7 == row1,col0
        CHECK(from.size() == 4);                           // Q/R/B/N
        Move q;
        CHECK(g.parseUci("a7a8q", q));
        CHECK(g.san(q) == "a8=Q+");
    }

    printf("\n%s (%d failures)\n", failures ? "FAILURES" : "ALL PASS", failures);
    return failures ? 1 : 0;
}
