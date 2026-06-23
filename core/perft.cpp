// perft.cpp — correctness + speed harness for the chess core.
//
// Perft (performance test) counts the number of leaf nodes in the move tree to
// a given depth. The counts for these positions are published and exact, so
// matching them proves the move generator is correct (castling, en passant,
// promotion, and check evasion are all exercised). It doubles as a benchmark:
// we print nodes/second.
//
// Build:  g++ -O3 -std=c++17 -march=native core/perft.cpp -o core/perft
// Run:    core/perft

#include "chess.hpp"
#include <cstdio>
#include <chrono>

using namespace chess;

struct Case {
    const char* name;
    const char* fen;
    int depth;
    uint64_t expected;
};

// Standard perft test positions (chessprogramming.org / Ethereal suite).
static const Case CASES[] = {
    {"startpos d1", nullptr, 1, 20},
    {"startpos d2", nullptr, 2, 400},
    {"startpos d3", nullptr, 3, 8902},
    {"startpos d4", nullptr, 4, 197281},
    {"startpos d5", nullptr, 5, 4865609},
    {"kiwipete d1", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 1, 48},
    {"kiwipete d2", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 2, 2039},
    {"kiwipete d3", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 3, 97862},
    {"kiwipete d4", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 4, 4085603},
    {"pos3 d5", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", 5, 674624},
    {"pos3 d6", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", 6, 11030083},
    {"pos4 d4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -", 4, 422333},
    {"pos5 d3", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", 3, 62379},
    {"pos5 d4", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", 4, 2103487},
    {"pos6 d4", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - -", 4, 3894594},
};

int main() {
    int passed = 0, total = 0;
    uint64_t grandNodes = 0;
    double grandSecs = 0.0;

    for (const auto& tc : CASES) {
        Board b;
        if (tc.fen) b.setFromFEN(tc.fen);
        else        b = Board::startpos();

        auto t0 = std::chrono::steady_clock::now();
        uint64_t nodes = perft(b, tc.depth);
        auto t1 = std::chrono::steady_clock::now();
        double secs = std::chrono::duration<double>(t1 - t0).count();

        bool ok = (nodes == tc.expected);
        passed += ok; ++total;
        grandNodes += nodes; grandSecs += secs;

        double mnps = secs > 0 ? nodes / secs / 1e6 : 0;
        printf("%-14s depth %d  nodes %12llu  expected %12llu  %s  %7.3fs  %6.1f Mnps\n",
               tc.name, tc.depth, (unsigned long long)nodes,
               (unsigned long long)tc.expected, ok ? "OK " : "FAIL",
               secs, mnps);
    }

    printf("\n%d/%d positions correct.\n", passed, total);
    if (grandSecs > 0)
        printf("Aggregate: %llu nodes in %.3fs = %.1f Mnps\n",
               (unsigned long long)grandNodes, grandSecs, grandNodes / grandSecs / 1e6);
    return passed == total ? 0 : 1;
}
