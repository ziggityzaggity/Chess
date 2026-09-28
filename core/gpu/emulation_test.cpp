// emulation_test.cpp — runs the real CUDA kernels (chess_cuda.cu) on the CPU
// through cuda_emulation.hpp and checks them against the CPU batch engine.
// Needs no GPU or CUDA toolkit; see cuda_emulation.hpp for what it covers.
//
// Build: g++ -O2 -std=c++17 -Icore core/gpu/emulation_test.cpp -o gpu_emulation_test
// Run:   ./gpu_emulation_test

#define CHESS_CUDA_EMULATE 1
#include "chess_cuda.cu"
#include "batch.hpp"

#include <cstdio>
#include <vector>

using namespace chess;

static int failures = 0;
#define CHECK(cond) do { \
    if (!(cond)) { std::printf("  FAIL %s  (%s:%d)\n", #cond, __FILE__, __LINE__); ++failures; } \
} while (0)

int main() {
    std::printf("[emulated device: %s, %s]\n", gpu::deviceName(0).c_str(), gpu::buildInfo().c_str());
    CHECK(gpu::available());

    std::printf("[perft through the kernels]\n");
    struct Case { const char* fen; int depth; uint64_t expected; };
    const Case cases[] = {
        {"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 4, 197281},
        {"r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", 3, 97862},
        {"8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", 5, 674624},
        {"r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -", 3, 9467},
        {"rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", 3, 62379},
    };
    for (const Case& c : cases) {
        const uint64_t n = gpu::perft(c.fen, c.depth, 0);
        std::printf("  depth %d: %llu (expected %llu)\n", c.depth, (unsigned long long)n,
                    (unsigned long long)c.expected);
        CHECK(n == c.expected);
    }

    // A batch big enough that encode's grid is capped at MAX_BLOCKS, so the
    // grid-stride path runs too: 16k boards x 1216 floats > 65536 x 256.
    std::vector<Board> boards;
    {
        Board root;
        root.setFromFEN("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -");
        std::vector<Board> level = {root};
        while (boards.size() < 16000) {
            std::vector<Board> next;
            for (const Board& b : level)
                b.forEachLegal([&](const Move&, const Board& c) { next.push_back(c); });
            boards.insert(boards.end(), next.begin(), next.end());
            level.swap(next);
        }
        boards.resize(16000);
    }
    const int64_t n = static_cast<int64_t>(boards.size());
    std::printf("[kernels vs CPU batch engine on %lld boards]\n", (long long)n);

    std::vector<float> encGpu(n * ENCODED_FLOATS), encCpu(n * ENCODED_FLOATS);
    gpu::encode(boards.data(), n, encGpu.data(), 0, 0);
    batch::encode(boards.data(), n, encCpu.data());
    CHECK(encGpu == encCpu);

    std::vector<int32_t> cGpu(n), cCpu(n);
    std::vector<uint8_t> sGpu(n), sCpu(n);
    gpu::countLegal(boards.data(), n, cGpu.data(), sGpu.data(), 0, 0);
    batch::countLegal(boards.data(), n, cCpu.data(), sCpu.data());
    CHECK(cGpu == cCpu);
    CHECK(sGpu == sCpu);

    std::vector<int64_t> offsets(n + 1);
    const int64_t total = batch::exclusiveScan(cCpu.data(), n, offsets.data());
    std::vector<Board> kGpu(total), kCpu(total);
    std::vector<Move> mGpu(total), mCpu(total);
    std::vector<int64_t> pGpu(total), pCpu(total);
    gpu::expand(boards.data(), n, offsets.data(), kGpu.data(), mGpu.data(), pGpu.data(), 0, 0);
    batch::expand(boards.data(), n, offsets.data(), kCpu.data(), mCpu.data(), pCpu.data());
    int bad = 0;
    for (int64_t i = 0; i < total; ++i)
        bad += std::memcmp(&kGpu[i], &kCpu[i], sizeof(Board)) != 0 || !(mGpu[i] == mCpu[i]) || pGpu[i] != pCpu[i];
    CHECK(bad == 0);
    std::printf("  %lld children compared\n", (long long)total);

    // Optional outputs may be null.
    gpu::countLegal(boards.data(), n, cGpu.data(), nullptr, 0, 0);
    gpu::expand(boards.data(), n, offsets.data(), kGpu.data(), nullptr, nullptr, 0, 0);
    CHECK(cGpu == cCpu);

    std::printf("\n%s (%d failures)\n", failures ? "FAILURES" : "ALL PASS", failures);
    return failures ? 1 : 0;
}
