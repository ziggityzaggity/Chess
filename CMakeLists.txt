cmake_minimum_required(VERSION 3.16)
project(ChessCore LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# The engine is header-only: an INTERFACE target that just carries the include
# path. Everything (native tests, the WASM module, future pybind module) links
# against this.
add_library(chess_core INTERFACE)
target_include_directories(chess_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/core)

if(EMSCRIPTEN)
    # WASM interface for the JS frontend.
    add_subdirectory(bindings/web)
else()
    # Native correctness/benchmark executables + CTest.
    add_executable(perft     core/perft.cpp)
    add_executable(game_demo core/game_demo.cpp)
    target_link_libraries(perft     PRIVATE chess_core)
    target_link_libraries(game_demo PRIVATE chess_core)

    find_package(Threads REQUIRED)
    add_executable(perft_par core/perft_parallel.cpp)
    target_link_libraries(perft_par PRIVATE chess_core Threads::Threads)

    enable_testing()
    add_test(NAME perft     COMMAND perft)
    add_test(NAME game_demo COMMAND game_demo)
endif()
