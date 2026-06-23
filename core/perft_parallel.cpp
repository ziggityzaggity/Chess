// perft_parallel.cpp — demonstrates that the core parallelizes trivially.
//
// Because Board is trivially-copyable Plain-Old-Data and the move generator has
// no global mutable state, parallelism needs no locks: give each thread its own
// Board (a plain copy) and split the root moves across threads. This is the
// same property that later lets you (a) run many self-play games concurrently
// for an ML workflow, and (b) batch boards onto a GPU.
//
// Build: g++ -O3 -std=c++17 -march=native -pthread core/perft_parallel.cpp -o core/perft_par
// Run:   core/perft_par [depth]

#include "chess.hpp"
#include <cstdio>
#include <chrono>
#include <thread>
#include <atomic>
#include <vector>

using namespace chess;

int main(int argc, char** argv) {
    int depth = (argc > 1) ? atoi(argv[1]) : 6;

    Board root = Board::startpos();
    MoveList rootMoves;
    root.generateLegal(rootMoves);

    unsigned hw = std::thread::hardware_concurrency();
    if (hw == 0) hw = 4;
    unsigned nThreads = std::min<unsigned>(hw, rootMoves.count);

    std::atomic<uint64_t> total{0};
    std::atomic<int>      next{0};   // shared work index — the only shared state

    auto worker = [&]() {
        // Each thread owns a private copy of the board: no locks, no sharing.
        Board b = root;
        Undo u;
        uint64_t local = 0;
        for (;;) {
            int i = next.fetch_add(1);
            if (i >= rootMoves.count) break;
            b.makeMove(rootMoves.moves[i], u);
            local += perft(b, depth - 1);
            b.unmakeMove(rootMoves.moves[i], u);
        }
        total.fetch_add(local);
    };

    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> pool;
    for (unsigned t = 0; t < nThreads; ++t) pool.emplace_back(worker);
    for (auto& th : pool) th.join();
    auto t1 = std::chrono::steady_clock::now();

    double secs = std::chrono::duration<double>(t1 - t0).count();
    uint64_t nodes = total.load();
    printf("startpos perft(%d) = %llu  across %u threads  %.3fs  %.1f Mnps\n",
           depth, (unsigned long long)nodes, nThreads, secs, nodes / secs / 1e6);
    return 0;
}
