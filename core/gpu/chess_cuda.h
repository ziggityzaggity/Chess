// chess_cuda.h — host-side API for the CUDA batch kernels.
//
// Plain C++ (no CUDA headers), so any translation unit can include it — the
// Python bindings are compiled by the host compiler and only link against
// the kernels. Every pointer argument is a *device* pointer and `stream` is a
// cudaStream_t passed as an integer (0 = the default stream), so a caller
// such as PyTorch can hand over tensor.data_ptr() and its current stream and
// the kernels are ordered with its own work, with no copies or syncs.
//
// Layouts match the CPU batch API (batch.hpp): boards are arrays of 72-byte
// chess::Board, moves arrays of 4-byte chess::Move, and encoded positions are
// (N, 19, 8, 8) float32 — see encode.hpp.
//
// When the library is built without CUDA (gpu/chess_cuda_stub.cpp),
// available() returns false and every other call throws std::runtime_error.

#pragma once
#include <cstdint>
#include <string>

namespace chess {
namespace gpu {

bool available();                       // built with CUDA and a device is present
int  deviceCount();
std::string deviceName(int device);
std::string buildInfo();                // toolkit version + compiled architectures

// out[i] = encodeBoard(boards[i]); out holds n * 19 * 64 floats.
void encode(const void* boards, int64_t n, float* out, int device, uintptr_t stream);

// counts[i] = number of legal moves of boards[i]; status (may be null) gets
// the chess::Status code of each board.
void countLegal(const void* boards, int64_t n, int32_t* counts, uint8_t* status,
                int device, uintptr_t stream);

// Writes the legal children of boards[i] at offsets[i] onwards, where
// offsets is the exclusive prefix sum of countLegal()'s counts. children,
// moves and parent may each be null when not needed.
void expand(const void* boards, int64_t n, const int64_t* offsets, void* children,
            void* moves, int64_t* parent, int device, uintptr_t stream);

// Breadth-first perft from a FEN, entirely on the device (host memory only
// for the prefix sums). A self-test: matching the published node counts
// proves the device move generator is correct.
uint64_t perft(const std::string& fen, int depth, int device);

} // namespace gpu
} // namespace chess
