# WASM module — only configured under the Emscripten toolchain (emcmake).
# Produces chessengine.js (loader) + chessengine.wasm, and copies index.html
# next to them so the build dir is directly servable.

add_executable(chessengine chess_web.cpp)
target_link_libraries(chessengine PRIVATE chess_core)
set_target_properties(chessengine PROPERTIES OUTPUT_NAME chessengine)

target_compile_options(chessengine PRIVATE -O3)
target_link_options(chessengine PRIVATE
    -O3
    -lembind                              # embind glue
    -sMODULARIZE=1                        # export a factory, not globals
    -sEXPORT_NAME=createChessEngine       # window.createChessEngine()
    -sENVIRONMENT=web,node                # usable in a page and in node tests
    -sALLOW_MEMORY_GROWTH=1
    -sFILESYSTEM=0                        # we use no FS -> smaller output
)

add_custom_command(TARGET chessengine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
            ${CMAKE_CURRENT_SOURCE_DIR}/index.html
            $<TARGET_FILE_DIR:chessengine>/index.html
    COMMENT "Copying demo index.html next to the WASM module")
