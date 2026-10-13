// cuda_emulation.hpp — run chess_cuda.cu's kernels on the CPU, for testing.
//
// With CHESS_CUDA_EMULATE defined, chess_cuda.cu includes this header instead
// of <cuda_runtime.h> and is compiled as ordinary C++. Kernel launches
// (CHESS_LAUNCH) then execute every thread of the grid sequentially, and the
// runtime calls the kernels' host code uses are backed by host memory.
//
// That runs the real kernel bodies — index arithmetic, grid-stride loops,
// prefix-sum offsets — without a GPU. It is faithful for these kernels
// because they use no shared memory, atomics or barriers: every thread only
// reads inputs and writes its own outputs, so execution order cannot matter.
// What it cannot check is device code generation, so the device-only paths
// in chess.hpp are covered separately (a static_assert pins the closed-form
// piece steps to the host tables; ml_test compares the streaming and buffered
// move generators).

#pragma once
#include <cstdlib>
#include <cstring>

#define __global__
#define __device__
#define __host__
#define __forceinline__ inline
#define __launch_bounds__(...)

struct dim3 {
    unsigned x = 1, y = 1, z = 1;
    dim3() = default;
    dim3(unsigned x_) : x(x_) {}
};
inline thread_local dim3 blockIdx, threadIdx, blockDim, gridDim;

#define CHESS_LAUNCH(kernel, grid, block, stream, ...)                          \
    do {                                                                        \
        (void)(stream);                                                         \
        gridDim = dim3(grid); blockDim = dim3(block);                           \
        for (unsigned bx = 0; bx < gridDim.x; ++bx)                             \
            for (unsigned tx = 0; tx < blockDim.x; ++tx) {                      \
                blockIdx = dim3(bx); threadIdx = dim3(tx);                      \
                kernel(__VA_ARGS__);                                            \
            }                                                                   \
    } while (0)

#define CUDART_VERSION 13000

typedef int cudaError_t;
typedef void* cudaStream_t;
enum { cudaSuccess = 0, cudaErrorInvalidValue = 1 };
enum cudaMemcpyKind { cudaMemcpyHostToDevice, cudaMemcpyDeviceToHost };

struct cudaDeviceProp { char name[256]; };

inline const char* cudaGetErrorString(cudaError_t e) {
    return e == cudaSuccess ? "no error" : "emulated CUDA error";
}
inline cudaError_t cudaGetLastError() { return cudaSuccess; }
inline cudaError_t cudaGetDeviceCount(int* n) { *n = 1; return cudaSuccess; }
inline cudaError_t cudaGetDevice(int* d) { *d = 0; return cudaSuccess; }
inline cudaError_t cudaSetDevice(int d) { return d == 0 ? cudaSuccess : cudaErrorInvalidValue; }
inline cudaError_t cudaGetDeviceProperties(cudaDeviceProp* p, int) {
    std::strcpy(p->name, "CPU emulator");
    return cudaSuccess;
}
inline cudaError_t cudaMalloc(void* ptr, size_t bytes) {
    *static_cast<void**>(ptr) = std::malloc(bytes ? bytes : 1);
    return cudaSuccess;
}
template <class T> inline cudaError_t cudaMalloc(T** ptr, size_t bytes) {
    return cudaMalloc(static_cast<void*>(ptr), bytes);
}
inline cudaError_t cudaFree(void* p) { std::free(p); return cudaSuccess; }
inline cudaError_t cudaMemcpy(void* dst, const void* src, size_t bytes, cudaMemcpyKind) {
    std::memcpy(dst, src, bytes);
    return cudaSuccess;
}
inline cudaError_t cudaDeviceSynchronize() { return cudaSuccess; }
