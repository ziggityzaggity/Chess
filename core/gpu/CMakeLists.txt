# chess_gpu — the CUDA batch kernels, or a stub when CUDA is unavailable.
#
# CHESS_CUDA (cache variable, set in the root CMakeLists.txt):
#   AUTO  build the kernels if a CUDA compiler is found (default)
#   ON    require CUDA
#   OFF   always use the stub
#
# GPU architectures: pass -DCMAKE_CUDA_ARCHITECTURES=... to choose. Otherwise
# we compile for the GPUs nvidia-smi reports (fast builds on Colab), falling
# back to Turing..Hopper plus PTX for newer GPUs.

set(_chess_use_cuda OFF)
if(NOT CHESS_CUDA STREQUAL "OFF")
    include(CheckLanguage)
    check_language(CUDA)
    if(CMAKE_CUDA_COMPILER)
        set(_chess_use_cuda ON)
    elseif(CHESS_CUDA STREQUAL "ON")
        message(FATAL_ERROR "CHESS_CUDA=ON but no CUDA compiler was found "
                            "(set CUDACXX or put nvcc on PATH)")
    else()
        message(STATUS "chess: no CUDA compiler found; GPU kernels disabled")
    endif()
endif()

if(_chess_use_cuda)
    if(NOT DEFINED CMAKE_CUDA_ARCHITECTURES OR CMAKE_CUDA_ARCHITECTURES STREQUAL "")
        find_program(_chess_nvidia_smi nvidia-smi)
        set(_chess_archs "")
        if(_chess_nvidia_smi)
            execute_process(COMMAND ${_chess_nvidia_smi} --query-gpu=compute_cap --format=csv,noheader
                            OUTPUT_VARIABLE _chess_caps RESULT_VARIABLE _chess_smi_rc
                            OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
            if(_chess_smi_rc EQUAL 0 AND _chess_caps)
                string(REPLACE "\n" ";" _chess_caps "${_chess_caps}")
                foreach(_cap IN LISTS _chess_caps)
                    string(STRIP "${_cap}" _cap)
                    string(REPLACE "." "" _cap "${_cap}")
                    if(_cap MATCHES "^[0-9]+$")
                        list(APPEND _chess_archs ${_cap})
                    endif()
                endforeach()
                list(REMOVE_DUPLICATES _chess_archs)
            endif()
        endif()
        if(NOT _chess_archs)
            set(_chess_archs 75-real 80-real 86-real 89-real 90)
        endif()
        set(CMAKE_CUDA_ARCHITECTURES ${_chess_archs})
    endif()
    enable_language(CUDA)
    find_package(CUDAToolkit REQUIRED)
    message(STATUS "chess: building CUDA kernels for architectures ${CMAKE_CUDA_ARCHITECTURES}")

    add_library(chess_gpu STATIC chess_cuda.cu)
    set_target_properties(chess_gpu PROPERTIES
        CUDA_STANDARD 17
        CUDA_STANDARD_REQUIRED ON
        POSITION_INDEPENDENT_CODE ON)
    # No --use_fast_math: the encoder's one division must round exactly like
    # the CPU's so GPU and CPU encodings are bit-identical.
    # The architecture list is ;-separated, which a definition cannot hold.
    string(REPLACE ";" "," _chess_arch_string "${CMAKE_CUDA_ARCHITECTURES}")
    target_compile_definitions(chess_gpu PRIVATE "CHESS_CUDA_ARCHS=\"${_chess_arch_string}\"")
    target_compile_definitions(chess_gpu PUBLIC CHESS_HAS_CUDA=1)
    # Link the CUDA runtime statically: the module then works next to any
    # PyTorch build (each keeps its own runtime; both share the driver).
    target_link_libraries(chess_gpu PUBLIC chess_core CUDA::cudart_static)
else()
    add_library(chess_gpu STATIC chess_cuda_stub.cpp)
    set_target_properties(chess_gpu PROPERTIES POSITION_INDEPENDENT_CODE ON)
    target_compile_definitions(chess_gpu PUBLIC CHESS_HAS_CUDA=0)
    target_link_libraries(chess_gpu PUBLIC chess_core)
endif()
target_include_directories(chess_gpu PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

set(CHESS_GPU_ENABLED ${_chess_use_cuda} PARENT_SCOPE)
