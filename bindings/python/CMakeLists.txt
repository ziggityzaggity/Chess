# Python module chess_engine._core (pybind11). Built by `pip install .` from
# the repo root (scikit-build-core, see pyproject.toml), or by a plain CMake
# build with -DCHESS_BUILD_PYTHON=ON.

find_package(Python 3.9 REQUIRED COMPONENTS Interpreter Development.Module)
find_package(pybind11 CONFIG REQUIRED)
find_package(Threads REQUIRED)

pybind11_add_module(_core MODULE module.cpp)
target_link_libraries(_core PRIVATE chess_core chess_gpu Threads::Threads)
target_compile_definitions(_core PRIVATE VERSION_INFO="${PROJECT_VERSION}")

if(SKBUILD)
    # scikit-build-core copies the pure-Python package (bindings/python/
    # chess_engine) into the wheel; the compiled module goes next to it.
    install(TARGETS _core LIBRARY DESTINATION chess_engine)
else()
    # Plain CMake build: assemble an importable package in the build tree,
    # e.g. PYTHONPATH=build/python python -c "import chess_engine". The .py
    # files are symlinked, so edits to them take effect without rebuilding.
    set(_pkg ${CMAKE_BINARY_DIR}/python/chess_engine)
    set_target_properties(_core PROPERTIES LIBRARY_OUTPUT_DIRECTORY ${_pkg})
    file(MAKE_DIRECTORY ${_pkg})
    file(GLOB _py_sources CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/chess_engine/*.py)
    foreach(_src IN LISTS _py_sources)
        get_filename_component(_name ${_src} NAME)
        file(CREATE_LINK ${_src} ${_pkg}/${_name} SYMBOLIC COPY_ON_ERROR)
    endforeach()
endif()
