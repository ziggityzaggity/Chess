// chess_cuda_stub.cpp — stands in for chess_cuda.cu in builds without a CUDA
// toolkit, so callers can link unconditionally and check available().

#include "chess_cuda.h"
#include <stdexcept>

namespace chess {
namespace gpu {
namespace {
[[noreturn]] void unavailable() {
    throw std::runtime_error("chess engine was built without CUDA support "
                             "(install the CUDA toolkit and rebuild to enable GPU kernels)");
}
} // namespace

bool available() { return false; }
int  deviceCount() { return 0; }
std::string deviceName(int) { unavailable(); }
std::string buildInfo() { return "built without CUDA"; }
void encode(const void*, int64_t, float*, int, uintptr_t) { unavailable(); }
void countLegal(const void*, int64_t, int32_t*, uint8_t*, int, uintptr_t) { unavailable(); }
void expand(const void*, int64_t, const int64_t*, void*, void*, int64_t*, int, uintptr_t) {
    unavailable();
}
uint64_t perft(const std::string&, int, int) { unavailable(); }

} // namespace gpu
} // namespace chess
