// gpu_selftest.cpp — checks the CUDA move generator against published perft
// counts. Built by CMake when CUDA is available; needs a GPU to run.
//
// Run: build/gpu_selftest

#include "chess_cuda.h"
#include <chrono>
#include <cstdio>

int main() {
    if (!chess::gpu::available()) {
        std::printf("no CUDA device available: skipping (%s)\n", chess::gpu::buildInfo().c_str());
        return 0;
    }
    std::printf("device 0: %s (%s)\n", chess::gpu::deviceName(0).c_str(),
                chess::gpu::buildInfo().c_str());
    struct Case { const char* name; const char* fen; int depth; unsigned long long expected; };
    const Case cases[] = {
        {"startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 5, 4865609ULL},
        {"kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 4, 4085603ULL},
        {"pos3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", 5, 674624ULL},
        {"pos4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -", 4, 422333ULL},
        {"pos5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", 4, 2103487ULL},
    };
    int failures = 0;
    for (const Case& c : cases) {
        auto t0 = std::chrono::steady_clock::now();
        unsigned long long n = chess::gpu::perft(c.fen, c.depth, 0);
        double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        bool ok = n == c.expected;
        failures += !ok;
        std::printf("%-9s depth %d  %12llu  %s  %.3fs\n", c.name, c.depth, n, ok ? "OK  " : "FAIL", s);
    }
    std::printf("%s\n", failures ? "GPU SELFTEST FAILED" : "GPU SELFTEST PASSED");
    return failures ? 1 : 0;
}
