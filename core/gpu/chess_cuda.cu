// chess_cuda.cu — CUDA kernels for the batch API (see chess_cuda.h).
//
// The kernels are deliberately thin: all chess logic comes from the same
// CHESS_HD functions the CPU uses (chess.hpp / encode.hpp), compiled for the
// device. The CPU batch code and these kernels therefore agree by
// construction, and the CPU test suite covers the logic the GPU runs.
//
// Parallel layout:
//   * encode      one thread per output float (board, plane, square), so
//                 consecutive threads write consecutive addresses (coalesced);
//   * countLegal  one thread per board;
//   * expand      one thread per board, writing its children to the slots its
//                 prefix-sum offset reserves (no atomics, deterministic order).
// All kernels use grid-stride loops, so any batch size works with a bounded
// grid.

#include "chess_cuda.h"

#if defined(CHESS_CUDA_EMULATE)
#include "cuda_emulation.hpp"   // CPU stand-ins for testing without a GPU
#else
#include <cuda_runtime.h>
#define CHESS_LAUNCH(kernel, grid, block, stream, ...) \
    kernel<<<(grid), (block), 0, (stream)>>>(__VA_ARGS__)
#endif

#include "encode.hpp"

#include <stdexcept>
#include <string>
#include <vector>

#ifndef CHESS_CUDA_ARCHS
#define CHESS_CUDA_ARCHS "unknown"
#endif

namespace chess {
namespace gpu {
namespace {

void check(cudaError_t err, const char* what) {
    if (err != cudaSuccess)
        throw std::runtime_error(std::string("CUDA error in ") + what + ": " +
                                 cudaGetErrorString(err));
}

// Makes `device` current for the duration of a call, then restores the
// caller's device (this library has its own CUDA runtime state, separate from
// PyTorch's, so it must not assume a current device).
class DeviceGuard {
public:
    explicit DeviceGuard(int device) {
        check(cudaGetDevice(&prev_), "cudaGetDevice");
        if (device != prev_) check(cudaSetDevice(device), "cudaSetDevice");
    }
    ~DeviceGuard() { cudaSetDevice(prev_); }
    DeviceGuard(const DeviceGuard&) = delete;
    DeviceGuard& operator=(const DeviceGuard&) = delete;
private:
    int prev_ = 0;
};

constexpr int ENCODE_BLOCK = 256;
constexpr int MOVEGEN_BLOCK = 128;   // move generation is register-heavy
constexpr int64_t MAX_BLOCKS = 1 << 16;

unsigned gridFor(int64_t work, int block) {
    int64_t blocks = (work + block - 1) / block;
    if (blocks < 1) blocks = 1;
    if (blocks > MAX_BLOCKS) blocks = MAX_BLOCKS;
    return static_cast<unsigned>(blocks);
}

__device__ __forceinline__ int64_t globalThread() {
    return static_cast<int64_t>(blockIdx.x) * blockDim.x + threadIdx.x;
}
__device__ __forceinline__ int64_t gridStride() {
    return static_cast<int64_t>(gridDim.x) * blockDim.x;
}

__global__ void encodeKernel(const Board* __restrict__ boards, int64_t n,
                             float* __restrict__ out) {
    const int64_t total = n * ENCODED_FLOATS;
    for (int64_t idx = globalThread(); idx < total; idx += gridStride()) {
        const int64_t b = idx / ENCODED_FLOATS;
        const int rem = static_cast<int>(idx - b * ENCODED_FLOATS);
        out[idx] = planeValue(boards[b], rem / PLANE_SIZE, rem % PLANE_SIZE);
    }
}

__global__ void __launch_bounds__(MOVEGEN_BLOCK)
countKernel(const Board* __restrict__ boards, int64_t n, int32_t* __restrict__ counts,
            uint8_t* __restrict__ status) {
    for (int64_t i = globalThread(); i < n; i += gridStride()) {
        const Board b = boards[i];
        uint8_t st = ST_ONGOING;
        counts[i] = countAndStatus(b, status ? &st : nullptr);
        if (status) status[i] = st;
    }
}

__global__ void __launch_bounds__(MOVEGEN_BLOCK)
expandKernel(const Board* __restrict__ boards, int64_t n, const int64_t* __restrict__ offsets,
             Board* __restrict__ children, Move* __restrict__ moves,
             int64_t* __restrict__ parent) {
    for (int64_t i = globalThread(); i < n; i += gridStride()) {
        const Board b = boards[i];
        const int64_t o = offsets[i];
        expandBoard(b, children ? children + o : nullptr, moves ? moves + o : nullptr,
                    parent ? parent + o : nullptr, i);
    }
}

// Minimal RAII device buffer for perft().
template <class T>
struct DeviceBuffer {
    T* ptr = nullptr;
    explicit DeviceBuffer(size_t count) {
        if (count) check(cudaMalloc(&ptr, count * sizeof(T)), "cudaMalloc");
    }
    ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
    DeviceBuffer(const DeviceBuffer&) = delete;
    DeviceBuffer& operator=(const DeviceBuffer&) = delete;
    DeviceBuffer(DeviceBuffer&& o) noexcept : ptr(o.ptr) { o.ptr = nullptr; }
    DeviceBuffer& operator=(DeviceBuffer&& o) noexcept {
        if (this != &o) { if (ptr) cudaFree(ptr); ptr = o.ptr; o.ptr = nullptr; }
        return *this;
    }
};

} // namespace

bool available() {
    int n = 0;
    return cudaGetDeviceCount(&n) == cudaSuccess && n > 0;
}

int deviceCount() {
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) return 0;
    return n;
}

std::string deviceName(int device) {
    cudaDeviceProp prop{};
    check(cudaGetDeviceProperties(&prop, device), "cudaGetDeviceProperties");
    return prop.name;
}

std::string buildInfo() {
    return "CUDA runtime " + std::to_string(CUDART_VERSION / 1000) + "." +
           std::to_string((CUDART_VERSION % 1000) / 10) + ", architectures " + CHESS_CUDA_ARCHS;
}

void encode(const void* boards, int64_t n, float* out, int device, uintptr_t stream) {
    if (n <= 0) return;
    DeviceGuard guard(device);
    auto s = reinterpret_cast<cudaStream_t>(stream);
    CHESS_LAUNCH(encodeKernel, gridFor(n * ENCODED_FLOATS, ENCODE_BLOCK), ENCODE_BLOCK, s,
                 static_cast<const Board*>(boards), n, out);
    check(cudaGetLastError(), "encode kernel launch");
}

void countLegal(const void* boards, int64_t n, int32_t* counts, uint8_t* status,
                int device, uintptr_t stream) {
    if (n <= 0) return;
    DeviceGuard guard(device);
    auto s = reinterpret_cast<cudaStream_t>(stream);
    CHESS_LAUNCH(countKernel, gridFor(n, MOVEGEN_BLOCK), MOVEGEN_BLOCK, s,
                 static_cast<const Board*>(boards), n, counts, status);
    check(cudaGetLastError(), "countLegal kernel launch");
}

void expand(const void* boards, int64_t n, const int64_t* offsets, void* children,
            void* moves, int64_t* parent, int device, uintptr_t stream) {
    if (n <= 0) return;
    DeviceGuard guard(device);
    auto s = reinterpret_cast<cudaStream_t>(stream);
    CHESS_LAUNCH(expandKernel, gridFor(n, MOVEGEN_BLOCK), MOVEGEN_BLOCK, s,
                 static_cast<const Board*>(boards), n, offsets, static_cast<Board*>(children),
                 static_cast<Move*>(moves), parent);
    check(cudaGetLastError(), "expand kernel launch");
}

uint64_t perft(const std::string& fen, int depth, int device) {
    Board root;
    if (!root.setFromFEN(fen)) throw std::invalid_argument("bad FEN: " + fen);
    if (depth <= 0) return 1;
    DeviceGuard guard(device);

    int64_t n = 1;
    DeviceBuffer<Board> level(1);
    check(cudaMemcpy(level.ptr, &root, sizeof(Board), cudaMemcpyHostToDevice), "cudaMemcpy");
    for (int d = 1;; ++d) {
        DeviceBuffer<int32_t> counts(n);
        CHESS_LAUNCH(countKernel, gridFor(n, MOVEGEN_BLOCK), MOVEGEN_BLOCK, cudaStream_t(0),
                     level.ptr, n, counts.ptr, nullptr);
        check(cudaGetLastError(), "countLegal kernel launch");
        std::vector<int32_t> hostCounts(n);
        check(cudaMemcpy(hostCounts.data(), counts.ptr, n * sizeof(int32_t),
                         cudaMemcpyDeviceToHost), "cudaMemcpy");
        if (d == depth) {
            uint64_t sum = 0;
            for (int32_t c : hostCounts) sum += static_cast<uint64_t>(c);
            return sum;
        }
        std::vector<int64_t> offsets(n + 1);
        int64_t total = 0;
        for (int64_t i = 0; i < n; ++i) { offsets[i] = total; total += hostCounts[i]; }
        offsets[n] = total;
        DeviceBuffer<int64_t> devOffsets(n + 1);
        check(cudaMemcpy(devOffsets.ptr, offsets.data(), (n + 1) * sizeof(int64_t),
                         cudaMemcpyHostToDevice), "cudaMemcpy");
        DeviceBuffer<Board> next(total);
        CHESS_LAUNCH(expandKernel, gridFor(n, MOVEGEN_BLOCK), MOVEGEN_BLOCK, cudaStream_t(0),
                     level.ptr, n, devOffsets.ptr, next.ptr, nullptr, nullptr);
        check(cudaGetLastError(), "expand kernel launch");
        check(cudaDeviceSynchronize(), "perft level");
        level = std::move(next);
        n = total;
        if (n == 0) return 0;
    }
}

} // namespace gpu
} // namespace chess
