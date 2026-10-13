cmake_minimum_required(VERSION 3.18)
project(ChessCore VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# The engine is header-only: an INTERFACE target that just carries the include
# path. Everything (native tests, the WASM module, the Python module and the
# CUDA kernels) links against this.
add_library(chess_core INTERFACE)
target_include_directories(chess_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/core)

option(CHESS_BUILD_PYTHON "Build the chess_engine Python module (pybind11)" OFF)
set(CHESS_CUDA "AUTO" CACHE STRING "Build the CUDA batch kernels: AUTO, ON or OFF")
set_property(CACHE CHESS_CUDA PROPERTY STRINGS AUTO ON OFF)

if(EMSCRIPTEN)
    # WASM interface for the JS frontend.
    add_subdirectory(bindings/web)
    return()
endif()

find_package(Threads REQUIRED)

# CUDA kernels (or a stub): used by the Python module and the GPU self-test.
if(SKBUILD OR CHESS_BUILD_PYTHON OR NOT CHESS_CUDA STREQUAL "OFF")
    add_subdirectory(core/gpu)
endif()

if(NOT SKBUILD)
    # Native correctness/benchmark executables + CTest.
    add_executable(perft     core/perft.cpp)
    add_executable(game_demo core/game_demo.cpp)
    add_executable(ml_test   core/ml_test.cpp)
    target_link_libraries(perft     PRIVATE chess_core)
    target_link_libraries(game_demo PRIVATE chess_core)
    target_link_libraries(ml_test   PRIVATE chess_core Threads::Threads)

    add_executable(perft_par core/perft_parallel.cpp)
    target_link_libraries(perft_par PRIVATE chess_core Threads::Threads)

    # The CUDA kernels compiled as plain C++ and run by a CPU emulator: checks
    # the kernel code against the CPU engine on machines without a GPU.
    add_executable(gpu_emulation_test core/gpu/emulation_test.cpp)
    target_link_libraries(gpu_emulation_test PRIVATE chess_core)
    target_include_directories(gpu_emulation_test PRIVATE core/gpu)

    enable_testing()
    add_test(NAME perft     COMMAND perft)
    add_test(NAME game_demo COMMAND game_demo)
    add_test(NAME ml_test   COMMAND ml_test WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
    add_test(NAME gpu_emulation_test COMMAND gpu_emulation_test)

    if(CHESS_GPU_ENABLED)
        # Runs only on a machine with a GPU: perft through the CUDA kernels.
        add_executable(gpu_selftest core/gpu/gpu_selftest.cpp)
        target_link_libraries(gpu_selftest PRIVATE chess_gpu)
        add_test(NAME gpu_selftest COMMAND gpu_selftest)
    endif()
endif()

if(SKBUILD OR CHESS_BUILD_PYTHON)
    add_subdirectory(bindings/python)
endif()
