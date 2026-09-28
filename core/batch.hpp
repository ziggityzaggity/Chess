// batch.hpp — multithreaded CPU versions of the batch (vectorised) API.
//
// The ML pipeline works on arrays of positions rather than one game at a time:
// encode N boards into network inputs, count the legal moves of N boards, or
// expand N boards into all of their children. Each operation here has a CUDA
// twin in gpu/chess_cuda.cu built from the same per-board functions in
// encode.hpp, so CPU and GPU results are identical by construction.
//
// Threads split the batch into contiguous chunks. Boards are POD and the move
// generator has no shared state, so no locks are needed; every output slot is
// written by exactly one thread.
//
// Variable-length output (children) uses the standard two-pass GPU pattern:
//   1. countLegal()       -> counts[i] = number of legal moves of board i
//   2. offsets = exclusive prefix sum of counts (child k of board i lands at
//      offsets[i] + k)
//   3. expand()           -> children, moves and parent indices

#pragma once
#include "encode.hpp"
#include <algorithm>
#include <cstdint>
#include <thread>
#include <vector>

namespace chess {
namespace batch {

inline int resolveThreads(int threads) {
    if (threads > 0) return threads;
    const unsigned hw = std::thread::hardware_concurrency();
    return hw ? static_cast<int>(hw) : 4;
}

// Calls fn(begin, end) over [0, n) split into contiguous chunks, one per
// thread. Small batches run inline: spawning threads costs more than it saves.
template <class Fn>
void parallelFor(int64_t n, int threads, Fn&& fn, int64_t minPerThread = 256) {
    if (n <= 0) return;
    int t = resolveThreads(threads);
    t = static_cast<int>(std::min<int64_t>(t, std::max<int64_t>(1, n / minPerThread)));
    if (t <= 1) { fn(int64_t(0), n); return; }
    std::vector<std::thread> pool;
    pool.reserve(t);
    const int64_t chunk = (n + t - 1) / t;
    for (int i = 0; i < t; ++i) {
        const int64_t b = i * chunk, e = std::min(n, b + chunk);
        if (b >= e) break;
        pool.emplace_back([&fn, b, e] { fn(b, e); });
    }
    for (auto& th : pool) th.join();
}

// out: n * ENCODED_FLOATS floats, (N, 19, 8, 8) row-major.
inline void encode(const Board* boards, int64_t n, float* out, int threads = 0) {
    parallelFor(n, threads, [&](int64_t b, int64_t e) {
        for (int64_t i = b; i < e; ++i) encodeBoard(boards[i], out + i * ENCODED_FLOATS);
    });
}

// counts[i] = legal moves of board i; status[i] (optional) = Status code.
inline void countLegal(const Board* boards, int64_t n, int32_t* counts,
                       uint8_t* status, int threads = 0) {
    parallelFor(n, threads, [&](int64_t b, int64_t e) {
        for (int64_t i = b; i < e; ++i)
            counts[i] = countAndStatus(boards[i], status ? status + i : nullptr);
    }, 64);
}

// Exclusive prefix sum: offsets[i] = counts[0] + ... + counts[i-1]; returns
// the total. offsets must hold n + 1 entries (offsets[n] = total).
inline int64_t exclusiveScan(const int32_t* counts, int64_t n, int64_t* offsets) {
    int64_t acc = 0;
    for (int64_t i = 0; i < n; ++i) { offsets[i] = acc; acc += counts[i]; }
    offsets[n] = acc;
    return acc;
}

// Writes the children of board i to children[offsets[i] ...]. Any of
// children / moves / parent may be null if not wanted.
inline void expand(const Board* boards, int64_t n, const int64_t* offsets,
                   Board* children, Move* moves, int64_t* parent, int threads = 0) {
    parallelFor(n, threads, [&](int64_t b, int64_t e) {
        for (int64_t i = b; i < e; ++i) {
            const int64_t o = offsets[i];
            expandBoard(boards[i], children ? children + o : nullptr,
                        moves ? moves + o : nullptr, parent ? parent + o : nullptr, i);
        }
    }, 64);
}

// perft over a set of root positions, breadth first: expand level by level
// and count legal moves at the last one. It uses exactly the batch primitives
// the GPU uses, so matching the published perft numbers validates them.
inline uint64_t perftBreadthFirst(const std::vector<Board>& roots, int depth, int threads = 0) {
    if (depth <= 0) return roots.size();
    std::vector<Board> level = roots;
    for (int d = 1; d < depth; ++d) {
        const int64_t n = static_cast<int64_t>(level.size());
        std::vector<int32_t> counts(n);
        std::vector<int64_t> offsets(n + 1);
        countLegal(level.data(), n, counts.data(), nullptr, threads);
        const int64_t total = exclusiveScan(counts.data(), n, offsets.data());
        std::vector<Board> next(total);
        expand(level.data(), n, offsets.data(), next.data(), nullptr, nullptr, threads);
        level.swap(next);
    }
    const int64_t n = static_cast<int64_t>(level.size());
    std::vector<int32_t> counts(n);
    countLegal(level.data(), n, counts.data(), nullptr, threads);
    uint64_t sum = 0;
    for (int32_t c : counts) sum += static_cast<uint64_t>(c);
    return sum;
}

} // namespace batch
} // namespace chess
