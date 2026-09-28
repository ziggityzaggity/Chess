// module.cpp — pybind11 bindings: the C++ chess core as the Python module
// `chess_engine._core` (re-exported by the `chess_engine` package).
//
// Three layers, from interactive to bulk:
//
//   * Game / Move      — a playable game with history, SAN/UCI, draw rules,
//                        and per-turn hooks for a neural network: encode()
//                        returns the current state as network input and
//                        children() every position one legal move away.
//   * numpy batch API  — encode_boards / count_legal / expand_boards /
//                        replay_games operate on (N, 72) uint8 arrays of
//                        chess::Board, multithreaded, with the GIL released.
//   * CUDA entry points (cuda_*) — the same operations as GPU kernels on
//                        device pointers; chess_engine.gpu wraps them for
//                        PyTorch tensors.
//
// Squares are 0..63 row-major with row 0 = rank 8 (the core's convention);
// UCI / SAN strings are the portable way to name moves.

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "batch.hpp"
#include "gpu/chess_cuda.h"
#include "pgn.hpp"

#include <cstring>
#include <sstream>
#include <thread>

namespace py = pybind11;
using namespace chess;

#ifndef CHESS_HAS_CUDA
#define CHESS_HAS_CUDA 0
#endif

namespace {

using U8Array = py::array_t<uint8_t, py::array::c_style | py::array::forcecast>;

// A validated, aligned view of an (N, 72) board array. Arrays from numpy and
// PyTorch are already 8-byte aligned; anything else is copied once.
struct BoardSpan {
    const Board* data = nullptr;
    int64_t n = 0;
    std::vector<Board> copy;

    explicit BoardSpan(const U8Array& a) {
        if (a.ndim() == 1 && a.shape(0) == BOARD_BYTES) n = 1;
        else if (a.ndim() == 2 && a.shape(1) == BOARD_BYTES) n = a.shape(0);
        else throw py::value_error("boards must be a uint8 array of shape (N, 72) or (72,)");
        const uint8_t* p = a.data();
        if (n > 0 && reinterpret_cast<uintptr_t>(p) % alignof(Board) != 0) {
            copy.resize(static_cast<size_t>(n));
            std::memcpy(copy.data(), p, static_cast<size_t>(n) * BOARD_BYTES);
            data = copy.data();
        } else {
            data = reinterpret_cast<const Board*>(p);
        }
    }
};

py::array_t<uint8_t> boardArray(const Board& b) {
    py::array_t<uint8_t> out(BOARD_BYTES);
    std::memcpy(out.mutable_data(), &b, BOARD_BYTES);
    return out;
}

py::array_t<uint8_t> boardsArray(const std::vector<Board>& boards) {
    py::array_t<uint8_t> out({static_cast<py::ssize_t>(boards.size()),
                              static_cast<py::ssize_t>(BOARD_BYTES)});
    if (!boards.empty()) std::memcpy(out.mutable_data(), boards.data(), boards.size() * BOARD_BYTES);
    return out;
}

Board boardFromFen(const std::string& fen) {
    Board b;
    if (!b.setFromFEN(fen)) throw py::value_error("invalid FEN: " + fen);
    return b;
}

// Encoding of one board as a (19, 8, 8) float32 array.
py::array_t<float> encodeOne(const Board& b) {
    py::array_t<float> out({NUM_PLANES, 8, 8});
    encodeBoard(b, out.mutable_data());
    return out;
}

// The positions one legal move away, in legal_moves() order.
py::tuple childrenOf(const Board& b) {
    std::vector<Board> kids;
    std::vector<Move> moves;
    b.forEachLegal([&](const Move& m, const Board& c) { kids.push_back(c); moves.push_back(m); });
    return py::make_tuple(boardsArray(kids), moves);
}

std::string moveRepr(const Move& m) { return "Move('" + m.uci() + "')"; }

} // namespace

PYBIND11_MODULE(_core, m) {
    m.doc() = "PyChess C++ chess engine: rules, PGN, network-input encoding, and "
              "multithreaded / CUDA batch move generation.";

    // ------------------------------------------------------------------ constants
    m.attr("WHITE") = static_cast<int>(WHITE);
    m.attr("BLACK") = static_cast<int>(BLACK);
    m.attr("BOARD_BYTES") = BOARD_BYTES;
    m.attr("NUM_PLANES") = NUM_PLANES;
    m.attr("CUDA_COMPILED") = static_cast<bool>(CHESS_HAS_CUDA);
    {
        py::list names;
        for (int p = 0; p < NUM_PLANES; ++p) names.append(planeName(p));
        m.attr("PLANE_NAMES") = names;
    }

    py::enum_<Result>(m, "Result")
        .value("ONGOING", Result::ONGOING)
        .value("WHITE_WINS", Result::WHITE_WINS)
        .value("BLACK_WINS", Result::BLACK_WINS)
        .value("DRAW", Result::DRAW);
    py::enum_<DrawReason>(m, "DrawReason")
        .value("NONE", DrawReason::NONE)
        .value("STALEMATE", DrawReason::STALEMATE)
        .value("FIFTY_MOVE", DrawReason::FIFTY_MOVE)
        .value("THREEFOLD", DrawReason::THREEFOLD)
        .value("INSUFFICIENT_MATERIAL", DrawReason::INSUFFICIENT_MATERIAL);
    py::enum_<Status>(m, "Status", "Per-position status codes returned by count_legal().")
        .value("ONGOING", ST_ONGOING)
        .value("CHECKMATE", ST_CHECKMATE)
        .value("STALEMATE", ST_STALEMATE)
        .value("INSUFFICIENT_MATERIAL", ST_INSUFFICIENT_MATERIAL)
        .value("FIFTY_MOVE", ST_FIFTY_MOVE);

    // ----------------------------------------------------------------------- Move
    py::class_<Move>(m, "Move", "A move: from/to squares (0..63, row 0 = rank 8), a flag and a promotion piece.")
        .def(py::init([](int from, int to, int flag, int promo) {
                 if (from < 0 || from > 63 || to < 0 || to > 63 || flag < 0 || flag > 7 || promo < 0 || promo > 6)
                     throw py::value_error("move fields out of range");
                 return Move{static_cast<uint8_t>(from), static_cast<uint8_t>(to),
                             static_cast<uint8_t>(flag), static_cast<uint8_t>(promo)};
             }), py::arg("from_square"), py::arg("to_square"), py::arg("flag") = 0, py::arg("promotion") = 0)
        .def_property_readonly("from_square", [](const Move& mv) { return mv.from; })
        .def_property_readonly("to_square", [](const Move& mv) { return mv.to; })
        .def_property_readonly("flag", [](const Move& mv) { return mv.flag; })
        .def_property_readonly("promotion", [](const Move& mv) { return mv.promo; })
        .def("uci", &Move::uci, "Long algebraic text, e.g. 'e2e4' or 'e7e8q'.")
        .def("is_capture", &Move::isCapture)
        .def("__eq__", [](const Move& a, const Move& b) { return a == b; })
        .def("__hash__", [](const Move& mv) {
            return (mv.from << 24) | (mv.to << 16) | (mv.flag << 8) | mv.promo;
        })
        .def("__repr__", &moveRepr)
        .def("__str__", &Move::uci);

    // ----------------------------------------------------------------------- Game
    py::class_<Game>(m, "Game",
                     "A chess game with move history, undo/redo, draw rules and SAN/UCI I/O.\n\n"
                     "For a neural-network player, encode() gives the current position as\n"
                     "network input and children() every position reachable in one move.")
        .def(py::init<>())
        .def(py::init([](const std::string& fen) {
                 Game g;
                 if (!g.setFen(fen)) throw py::value_error("invalid FEN: " + fen);
                 return g;
             }), py::arg("fen"))
        .def("reset", &Game::reset)
        .def("set_fen", &Game::setFen, py::arg("fen"))
        .def("fen", &Game::fen)
        .def_property_readonly("turn", [](const Game& g) { return static_cast<int>(g.turn()); },
                               "Side to move: 0 = white, 1 = black.")
        .def_property_readonly("ply", &Game::ply, "Number of moves played.")
        .def("key", &Game::key, "Zobrist hash of the position.")
        .def("piece_at", [](const Game& g, int sq) {
                 if (sq < 0 || sq > 63) throw py::index_error("square out of range");
                 return std::string(1, pieceGlyph(g.pieceAt(sq)));
             }, py::arg("square"), "Piece letter on a square (PNBRQK / pnbrqk, '.' if empty).")
        .def("legal_moves", &Game::legalMoves)
        .def("legal_uci", &Game::legalUci)
        .def("is_legal", &Game::isLegal, py::arg("move"))
        .def("push", &Game::push, py::arg("move"), "Play a legal move; returns False if illegal.")
        .def("push_uci", &Game::pushUci, py::arg("uci"))
        .def("push_san", &Game::pushSan, py::arg("san"))
        .def("parse_uci", [](const Game& g, const std::string& uci) -> py::object {
                 Move mv;
                 if (!g.parseUci(uci, mv)) return py::none();
                 return py::cast(mv);
             }, py::arg("uci"), "The legal move for a UCI string, or None.")
        .def("parse_san", [](const Game& g, const std::string& san) {
                 Move mv; std::string err;
                 if (!g.parseSan(san, mv, &err)) throw py::value_error(err);
                 return mv;
             }, py::arg("san"), "The legal move for a SAN string; raises ValueError if none.")
        .def("san", &Game::san, py::arg("move"))
        .def("undo", &Game::undo)
        .def("redo", &Game::redo)
        .def("can_undo", &Game::canUndo)
        .def("can_redo", &Game::canRedo)
        .def("history", &Game::history)
        .def("history_uci", &Game::historyUci)
        .def("in_check", &Game::inCheck)
        .def("is_checkmate", &Game::isCheckmate)
        .def("is_stalemate", &Game::isStalemate)
        .def("is_fifty_move", &Game::isFiftyMove)
        .def("is_threefold", &Game::isThreefold)
        .def("is_insufficient_material", &Game::isInsufficientMaterial)
        .def("is_game_over", &Game::isGameOver)
        .def("result", &Game::result)
        .def("draw_reason", &Game::drawReason)
        .def("pgn", &Game::pgnMovetext, "SAN movetext of the moves played.")
        .def("board_array", [](const Game& g) { return boardArray(g.board()); },
             "The position as a (72,) uint8 chess::Board — the compact state used by the batch API.")
        .def("encode", [](const Game& g) { return encodeOne(g.board()); },
             "The position as network input: float32 array of shape (19, 8, 8), from the side-to-move's view.")
        .def("children", [](const Game& g) { return childrenOf(g.board()); },
             "(boards, moves): every legal move and the (N, 72) positions they lead to.")
        .def("copy", [](const Game& g) { return Game(g); })
        .def("__str__", [](const Game& g) { return g.board().toString(); })
        .def("__repr__", [](const Game& g) { return "Game('" + g.fen() + "')"; });

    // ------------------------------------------------------------ single boards
    m.def("startpos", [] { return boardArray(Board::startpos()); },
          "The initial position as a (72,) uint8 board array.");
    m.def("board_from_fen", [](const std::string& fen) { return boardArray(boardFromFen(fen)); },
          py::arg("fen"));
    m.def("boards_from_fens", [](const std::vector<std::string>& fens) {
              std::vector<Board> out;
              out.reserve(fens.size());
              for (const auto& f : fens) out.push_back(boardFromFen(f));
              return boardsArray(out);
          }, py::arg("fens"));
    m.def("board_to_fen", [](const U8Array& a) {
              BoardSpan s(a);
              if (s.n != 1) throw py::value_error("expected a single (72,) board");
              return s.data[0].fen();
          }, py::arg("board"));
    m.def("board_to_string", [](const U8Array& a) {
              BoardSpan s(a);
              if (s.n != 1) throw py::value_error("expected a single (72,) board");
              return s.data[0].toString();
          }, py::arg("board"), "ASCII diagram (white pieces upper case, rank 8 first).");
    m.def("moves_to_uci", [](const U8Array& a) {
              if (!(a.ndim() == 2 && a.shape(1) == 4) && !(a.ndim() == 1 && a.shape(0) == 4))
                  throw py::value_error("moves must have shape (M, 4) or (4,)");
              const int64_t n = a.ndim() == 1 ? 1 : a.shape(0);
              const uint8_t* p = a.data();
              std::vector<std::string> out;
              out.reserve(static_cast<size_t>(n));
              for (int64_t i = 0; i < n; ++i)
                  out.push_back(Move{p[4 * i], p[4 * i + 1], p[4 * i + 2], p[4 * i + 3]}.uci());
              return out;
          }, py::arg("moves"), "UCI strings for an (M, 4) uint8 move array (from, to, flag, promo).");
    m.def("perft", [](const std::string& fen, int depth) {
              Board b = boardFromFen(fen);
              py::gil_scoped_release nogil;
              return perft(b, depth);
          }, py::arg("fen"), py::arg("depth"), "Leaf-node count of the move tree (depth-first, one thread).");

    // ------------------------------------------------------------ batch (numpy)
    m.def("encode_boards", [](const U8Array& a, int threads) {
              BoardSpan s(a);
              py::array_t<float> out({static_cast<py::ssize_t>(s.n), static_cast<py::ssize_t>(NUM_PLANES),
                                      py::ssize_t(8), py::ssize_t(8)});
              float* o = out.mutable_data();
              {
                  py::gil_scoped_release nogil;
                  batch::encode(s.data, s.n, o, threads);
              }
              return out;
          }, py::arg("boards"), py::arg("threads") = 0,
          "Encode (N, 72) boards into network input of shape (N, 19, 8, 8), float32.");

    m.def("count_legal", [](const U8Array& a, int threads) {
              BoardSpan s(a);
              py::array_t<int32_t> counts(s.n);
              py::array_t<uint8_t> status(s.n);
              int32_t* c = counts.mutable_data();
              uint8_t* st = status.mutable_data();
              {
                  py::gil_scoped_release nogil;
                  batch::countLegal(s.data, s.n, c, st, threads);
              }
              return py::make_tuple(counts, status);
          }, py::arg("boards"), py::arg("threads") = 0,
          "(counts int32[N], status uint8[N]): legal-move count and Status code per board.");

    m.def("expand_boards", [](const U8Array& a, int threads) {
              BoardSpan s(a);
              std::vector<int32_t> counts(static_cast<size_t>(s.n));
              py::array_t<int64_t> offsets(s.n + 1);
              int64_t* off = offsets.mutable_data();
              int64_t total = 0;
              {
                  py::gil_scoped_release nogil;
                  batch::countLegal(s.data, s.n, counts.data(), nullptr, threads);
                  total = batch::exclusiveScan(counts.data(), s.n, off);
              }
              py::array_t<uint8_t> children({static_cast<py::ssize_t>(total), static_cast<py::ssize_t>(BOARD_BYTES)});
              py::array_t<uint8_t> moves({static_cast<py::ssize_t>(total), py::ssize_t(4)});
              py::array_t<int64_t> parent(total);
              Board* ch = reinterpret_cast<Board*>(children.mutable_data());
              Move* mv = reinterpret_cast<Move*>(moves.mutable_data());
              int64_t* par = parent.mutable_data();
              {
                  py::gil_scoped_release nogil;
                  batch::expand(s.data, s.n, off, ch, mv, par, threads);
              }
              return py::make_tuple(children, moves, parent, offsets);
          }, py::arg("boards"), py::arg("threads") = 0,
          "Every legal child of every board: (children (M,72), moves (M,4), parent int64[M], "
          "offsets int64[N+1]); board i's children are rows offsets[i]:offsets[i+1].");

    m.def("perft_batch", [](const std::string& fen, int depth, int threads) {
              Board b = boardFromFen(fen);
              py::gil_scoped_release nogil;
              return batch::perftBreadthFirst({b}, depth, threads);
          }, py::arg("fen"), py::arg("depth"), py::arg("threads") = 0,
          "Breadth-first perft built from count_legal/expand_boards (the primitives the GPU uses).");

    // ------------------------------------------------------------------- PGN
    m.def("split_pgn", [](const std::string& text) {
              std::vector<PgnGame> games;
              {
                  py::gil_scoped_release nogil;
                  games = splitPgn(text);
              }
              py::list out;
              for (const auto& g : games) {
                  py::dict tags;
                  for (const auto& t : g.tags) tags[py::str(t.first)] = t.second;
                  out.append(py::make_tuple(tags, g.movetext));
              }
              return out;
          }, py::arg("text"), "Split PGN text into [(tags dict, movetext), ...].");

    m.def("san_tokens", [](const std::string& movetext) {
              std::string result;
              auto toks = sanTokens(movetext, &result);
              return py::make_tuple(toks, result);
          }, py::arg("movetext"),
          "(SAN moves, result): movetext without move numbers, comments, variations and NAGs.");

    m.def("replay_games", [](const std::vector<std::string>& movetexts,
                             const std::vector<std::string>& fens, int threads) {
              const int64_t g = static_cast<int64_t>(movetexts.size());
              if (!fens.empty() && static_cast<int64_t>(fens.size()) != g)
                  throw py::value_error("fens must be empty or have one entry per game");
              std::vector<Replay> reps(static_cast<size_t>(g));
              {
                  py::gil_scoped_release nogil;
                  batch::parallelFor(g, threads, [&](int64_t b, int64_t e) {
                      for (int64_t i = b; i < e; ++i) {
                          Board start = Board::startpos();
                          if (!fens.empty() && !fens[i].empty() && !start.setFromFEN(fens[i])) {
                              reps[i].positions.push_back(start);
                              reps[i].errorPly = 0;
                              reps[i].error = "invalid FEN: " + fens[i];
                              continue;
                          }
                          reps[i] = replayMovetext(movetexts[i], start);
                      }
                  }, 16);
              }
              int64_t total = 0;
              for (const auto& r : reps) total += static_cast<int64_t>(r.positions.size());

              py::array_t<uint8_t> boards({static_cast<py::ssize_t>(total), static_cast<py::ssize_t>(BOARD_BYTES)});
              py::array_t<uint8_t> nextMove({static_cast<py::ssize_t>(total), py::ssize_t(4)});
              py::array_t<int32_t> game(total), ply(total), nPlies(g), errorPly(g);
              uint8_t* bp = boards.mutable_data();
              uint8_t* mp = nextMove.mutable_data();
              int32_t* gp = game.mutable_data();
              int32_t* pp = ply.mutable_data();
              int64_t row = 0;
              for (int64_t i = 0; i < g; ++i) {
                  const Replay& r = reps[i];
                  const int64_t k = static_cast<int64_t>(r.positions.size());
                  std::memcpy(bp + row * BOARD_BYTES, r.positions.data(), k * BOARD_BYTES);
                  std::memset(mp + row * 4, 0, k * 4);
                  if (!r.moves.empty()) std::memcpy(mp + row * 4, r.moves.data(), r.moves.size() * 4);
                  for (int64_t j = 0; j < k; ++j) { gp[row + j] = static_cast<int32_t>(i); pp[row + j] = static_cast<int32_t>(j); }
                  nPlies.mutable_data()[i] = static_cast<int32_t>(r.moves.size());
                  errorPly.mutable_data()[i] = r.errorPly;
                  row += k;
              }
              std::vector<std::string> results, errors;
              results.reserve(reps.size());
              errors.reserve(reps.size());
              for (const auto& r : reps) { results.push_back(r.result); errors.push_back(r.error); }

              py::dict out;
              out["boards"] = boards;
              out["next_move"] = nextMove;
              out["game"] = game;
              out["ply"] = ply;
              out["n_plies"] = nPlies;
              out["error_ply"] = errorPly;
              out["result_token"] = results;
              out["error"] = errors;
              return out;
          }, py::arg("movetexts"), py::arg("fens") = std::vector<std::string>(), py::arg("threads") = 0,
          "Replay PGN movetexts through the engine (multithreaded). Returns a dict of numpy arrays:\n"
          "  boards (P,72) every position of every game (start included), next_move (P,4) the move\n"
          "  played from it (zeros after the last), game/ply int32[P] where it came from;\n"
          "  per game: n_plies, error_ply (-1 if the whole game replayed), result_token, error.");

    // ------------------------------------------------------------------ CUDA
    m.def("cuda_available", &gpu::available, "True if built with CUDA and a GPU is present.");
    m.def("cuda_device_count", &gpu::deviceCount);
    m.def("cuda_device_name", &gpu::deviceName, py::arg("device") = 0);
    m.def("cuda_build_info", &gpu::buildInfo);
    m.def("cuda_encode", [](uintptr_t boards, int64_t n, uintptr_t out, int device, uintptr_t stream) {
              py::gil_scoped_release nogil;
              gpu::encode(reinterpret_cast<const void*>(boards), n, reinterpret_cast<float*>(out), device, stream);
          }, py::arg("boards_ptr"), py::arg("n"), py::arg("out_ptr"), py::arg("device") = 0, py::arg("stream") = 0,
          "Low level: encode n device boards into a device float32 buffer. Prefer chess_engine.gpu.encode().");
    m.def("cuda_count_legal", [](uintptr_t boards, int64_t n, uintptr_t counts, uintptr_t status,
                                 int device, uintptr_t stream) {
              py::gil_scoped_release nogil;
              gpu::countLegal(reinterpret_cast<const void*>(boards), n, reinterpret_cast<int32_t*>(counts),
                              reinterpret_cast<uint8_t*>(status), device, stream);
          }, py::arg("boards_ptr"), py::arg("n"), py::arg("counts_ptr"), py::arg("status_ptr") = 0,
          py::arg("device") = 0, py::arg("stream") = 0,
          "Low level: legal-move counts (and optional status) of n device boards.");
    m.def("cuda_expand", [](uintptr_t boards, int64_t n, uintptr_t offsets, uintptr_t children,
                            uintptr_t moves, uintptr_t parent, int device, uintptr_t stream) {
              py::gil_scoped_release nogil;
              gpu::expand(reinterpret_cast<const void*>(boards), n, reinterpret_cast<const int64_t*>(offsets),
                          reinterpret_cast<void*>(children), reinterpret_cast<void*>(moves),
                          reinterpret_cast<int64_t*>(parent), device, stream);
          }, py::arg("boards_ptr"), py::arg("n"), py::arg("offsets_ptr"), py::arg("children_ptr"),
          py::arg("moves_ptr") = 0, py::arg("parent_ptr") = 0, py::arg("device") = 0, py::arg("stream") = 0,
          "Low level: write the legal children of n device boards at their prefix-sum offsets.");
    m.def("cuda_perft", [](const std::string& fen, int depth, int device) {
              py::gil_scoped_release nogil;
              return gpu::perft(fen, depth, device);
          }, py::arg("fen"), py::arg("depth"), py::arg("device") = 0,
          "Breadth-first perft computed by the CUDA kernels (a GPU self-test).");
}
