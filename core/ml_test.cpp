// ml_test.cpp — tests for the engine APIs used by the ML pipeline:
// SAN parsing, PGN reading, network-input encoding, position status, and the
// batch (vectorised) move generation shared with the CUDA kernels.
//
// Build: g++ -O2 -std=c++17 -pthread core/ml_test.cpp -o core/ml_test
// Run:   core/ml_test [path/to/games.pgn ...]   (defaults to pgns/*.pgn)

#include "batch.hpp"
#include "pgn.hpp"
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>

using namespace chess;

static int failures = 0;
#define CHECK(cond) do { \
    if (!(cond)) { printf("  FAIL %s  (%s:%d)\n", #cond, __FILE__, __LINE__); ++failures; } \
} while (0)

static const char* KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -";
static const char* POS3     = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -";
static const char* POS4     = "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -";
static const char* POS5     = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -";

static Board fromFen(const char* fen) { Board b; b.setFromFEN(fen); return b; }

// The legal move with the given UCI from/to squares (first promotion if any).
static bool parseUciLike(const Board& b, const std::string& uci, Move& out) {
    const int from = squareFromName(uci.substr(0, 2)), to = squareFromName(uci.substr(2, 2));
    MoveList ml; b.generateLegal(ml);
    for (const Move& m : ml) if (m.from == from && m.to == to) { out = m; return true; }
    return false;
}

// A spread of positions: perft suite roots plus every position reached by a
// few plies of their move trees.
static std::vector<Board> samplePositions() {
    std::vector<Board> roots = {Board::startpos(), fromFen(KIWIPETE), fromFen(POS3),
                                fromFen(POS4), fromFen(POS5)};
    std::vector<Board> out = roots;
    std::vector<Board> level = roots;
    for (int d = 0; d < 2; ++d) {
        std::vector<Board> next;
        for (const Board& b : level)
            b.forEachLegal([&](const Move&, const Board& c) { next.push_back(c); });
        out.insert(out.end(), next.begin(), next.end());
        level.swap(next);
    }
    return out;
}

static void testSanRoundTrip(const std::vector<Board>& positions) {
    printf("[SAN round trip on %zu positions]\n", positions.size());
    int moves = 0;
    for (const Board& b : positions) {
        MoveList ml; b.generateLegal(ml);
        for (const Move& m : ml) {
            Move back; std::string err;
            const std::string san = toSan(b, m);
            bool ok = parseSan(b, san, back, &err);
            if (!ok || !(back == m)) {
                printf("  FAIL %s -> %s (%s) in %s\n", m.uci().c_str(), san.c_str(),
                       err.c_str(), b.fen().c_str());
                ++failures;
            }
            ++moves;
        }
    }
    printf("  %d moves checked\n", moves);
}

static void testSanVariants() {
    printf("[SAN variants]\n");
    Move m;
    Board b = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    CHECK(parseSan(b, "O-O", m) && m.flag == F_CASTLE_K);
    CHECK(parseSan(b, "0-0-0", m) && m.flag == F_CASTLE_Q);
    CHECK(parseSan(b, "O-O+!", m) && m.flag == F_CASTLE_K);

    // En passant is written as a plain pawn capture.
    Board ep = fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    CHECK(parseSan(ep, "exd6", m) && m.flag == F_EN_PASSANT);
    CHECK(parseSan(ep, "exd6e.p.", m) && m.flag == F_EN_PASSANT);

    Board pr = fromFen("1n5k/P7/8/8/8/8/8/K7 w - - 0 1");
    CHECK(parseSan(pr, "a8=Q", m) && m.promo == QUEEN && m.flag == F_PROMO);
    CHECK(parseSan(pr, "a8N", m) && m.promo == KNIGHT);
    CHECK(parseSan(pr, "axb8=r+", m) && m.promo == ROOK && m.flag == F_PROMO_CAPTURE);
    CHECK(parseSan(pr, "a8", m) && m.promo == QUEEN);          // bare promotion -> queen

    // Disambiguation by file, rank, and square. Knights on b4, f4 and b2 all
    // reach d3: b2 needs its rank (b4 shares the file), b4 needs the full
    // square (b2 shares its file, f4 its rank), and f4 its file.
    Board d = fromFen("k7/8/8/8/1N3N2/8/1N6/K7 w - - 0 1");
    std::string err;
    CHECK(!parseSan(d, "Nd3", m, &err) && err.find("ambiguous") != std::string::npos);
    CHECK(!parseSan(d, "Nbd3", m, &err) && err.find("ambiguous") != std::string::npos);
    CHECK(parseSan(d, "N2d3", m) && squareName(m.from) == "b2");
    CHECK(parseSan(d, "Nb4d3", m) && squareName(m.from) == "b4");
    CHECK(parseSan(d, "Nfd3", m) && squareName(m.from) == "f4");
    CHECK(parseSan(d, "Nf4-d3", m) && squareName(m.from) == "f4");
    for (const char* s : {"b2", "b4", "f4"}) {       // toSan picks the same forms
        Move k; CHECK(parseUciLike(d, std::string(s) + "d3", k));
        CHECK(parseSan(d, toSan(d, k), m) && m == k);
    }
    Board c = fromFen("k7/8/8/3p4/4P3/8/8/K7 w - - 0 1");
    CHECK(parseSan(c, "ed5", m) && m.flag == F_CAPTURE);
    CHECK(!parseSan(c, "e6", m, &err));                              // illegal
    CHECK(!parseSan(Board::startpos(), "Qh5", m, &err));
    CHECK(!parseSan(Board::startpos(), "Zz9", m, &err));
}

static void testTokens() {
    printf("[movetext tokens]\n");
    std::string res;
    auto t = sanTokens("1. e4 {best by test} e5 2.Nf3 (2. f4 exf4 (2...d5)) Nc6 $1 "
                       "3. Bb5!? a6 ; comment\n 4... Nf6 5. O-O 1/2-1/2", &res);
    const std::vector<std::string> want = {"e4", "e5", "Nf3", "Nc6", "Bb5!?", "a6", "Nf6", "O-O"};
    CHECK(t == want);
    CHECK(res == "1/2-1/2");
    t = sanTokens("12... Qxe1+ 13. Kxe1 0-1", &res);
    CHECK(t.size() == 2 && t[0] == "Qxe1+" && res == "0-1");
    t = sanTokens("1. 0-0 0-0-0 *", &res);
    CHECK(t.size() == 2 && t[0] == "0-0" && t[1] == "0-0-0" && res == "*");
}

static void testPgnFile(const std::string& path) {
    std::ifstream in(path);
    if (!in) { printf("[pgn %s] skipped (not found)\n", path.c_str()); return; }
    std::stringstream ss; ss << in.rdbuf();
    auto games = splitPgn(ss.str());
    int ok = 0, plies = 0, resultMismatch = 0;
    for (const auto& g : games) {
        Board start;
        CHECK(gameStart(g, start));
        Replay r = replayMovetext(g.movetext, start);
        if (!r.ok()) { printf("  replay error in %s: %s\n", path.c_str(), r.error.c_str()); ++failures; continue; }
        ++ok; plies += static_cast<int>(r.moves.size());
        const std::string* tagResult = g.tag("Result");
        if (tagResult && !r.result.empty() && *tagResult != r.result) ++resultMismatch;
        // Every position replayed must re-generate the move that was played.
        for (size_t i = 0; i < r.moves.size(); ++i) {
            MoveList ml; r.positions[i].generateLegal(ml);
            bool found = false;
            for (const Move& m : ml) found |= (m == r.moves[i]);
            if (!found) { ++failures; break; }
        }
    }
    printf("[pgn %s] %zu games, %d replayed, %d plies, %d result-tag mismatches\n",
           path.c_str(), games.size(), ok, plies, resultMismatch);
    CHECK(ok == static_cast<int>(games.size()));
}

static void testEncoding(const std::vector<Board>& positions) {
    printf("[encoding]\n");
    // Per-element (GPU) and per-board (CPU) encoders agree everywhere.
    std::vector<float> buf(ENCODED_FLOATS);
    int mismatches = 0;
    for (const Board& b : positions) {
        encodeBoard(b, buf.data());
        for (int p = 0; p < NUM_PLANES; ++p)
            for (int v = 0; v < 64; ++v)
                if (buf[p * 64 + v] != planeValue(b, p, v)) ++mismatches;
    }
    CHECK(mismatches == 0);

    auto plane = [&](int p, int v) { return buf[p * 64 + v]; };
    auto planeSum = [&](int p) { float s = 0; for (int v = 0; v < 64; ++v) s += plane(p, v); return s; };

    Board s = Board::startpos();
    encodeBoard(s, buf.data());
    CHECK(planeSum(PL_OUR_PIECES + 0) == 8 && planeSum(PL_THEIR_PIECES + 0) == 8);
    CHECK(plane(PL_OUR_PIECES + 5, sqOf(7, 4)) == 1.0f);          // our king on e1 (row 7)
    CHECK(plane(PL_THEIR_PIECES + 5, sqOf(0, 4)) == 1.0f);        // their king on e8
    for (int p = PL_OUR_OO; p <= PL_THEIR_OOO; ++p) CHECK(planeSum(p) == 64);
    CHECK(planeSum(PL_EP) == 0 && planeSum(PL_HALFMOVE) == 0 && planeSum(PL_ONES) == 64);

    // After 1.e4 black is to move: black's pieces become "ours", flipped so
    // they sit at the bottom; white's e-pawn on e4 is theirs, seen on e5.
    Board e4 = s; Move m; parseSan(e4, "e4", m); Undo u; e4.makeMove(m, u);
    encodeBoard(e4, buf.data());
    CHECK(plane(PL_OUR_PIECES + 5, sqOf(7, 4)) == 1.0f);          // black king on "e1"
    CHECK(plane(PL_OUR_PIECES + 0, sqOf(6, 3)) == 1.0f);          // black d-pawn on "d2"
    CHECK(plane(PL_THEIR_PIECES + 0, sqOf(3, 4)) == 1.0f);        // e4 pawn viewed on e5
    CHECK(plane(PL_EP, sqOf(2, 4)) == 1.0f && planeSum(PL_EP) == 1);   // e3 target seen as e6

    // A colour-flipped position must encode identically (the symmetry the
    // side-to-move perspective relies on).
    Board w = fromFen("r3k2r/8/8/8/4P3/8/8/R3K2R b Kq e3 7 30");
    Board bl = fromFen("r3k2r/8/8/4p3/8/8/8/R3K2R w Qk e6 7 30");
    std::vector<float> a(ENCODED_FLOATS), bb(ENCODED_FLOATS);
    encodeBoard(w, a.data()); encodeBoard(bl, bb.data());
    CHECK(a == bb);
    CHECK(a[PL_OUR_OO * 64] == 0.0f && a[PL_OUR_OOO * 64] == 1.0f);   // black to move: "q" only
    CHECK(a[PL_THEIR_OO * 64] == 1.0f && a[PL_THEIR_OOO * 64] == 0.0f);
    CHECK(std::fabs(a[PL_HALFMOVE * 64] - 0.07f) < 1e-6f);
}

static void testStatus() {
    printf("[status]\n");
    auto st = [](const char* fen) { Board b = fromFen(fen); return boardStatus(b, b.countLegal()); };
    CHECK(st("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3") == ST_CHECKMATE);
    CHECK(st("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1") == ST_STALEMATE);
    CHECK(st("8/8/4k3/8/8/3K1B2/8/8 w - - 0 1") == ST_INSUFFICIENT_MATERIAL);
    CHECK(st("8/8/4k3/8/8/3K1R2/8/8 w - - 100 80") == ST_FIFTY_MOVE);
    CHECK(st("8/8/4k3/8/8/3K1R2/8/8 w - - 99 80") == ST_ONGOING);
    CHECK(st(KIWIPETE) == ST_ONGOING);
}

static void testLegalStrategiesAgree(const std::vector<Board>& positions) {
    printf("[buffered vs streaming legal move generation]\n");
    int diffs = 0;
    for (const Board& b : positions) {
        std::vector<Move> x, y;
        std::vector<Board> cx, cy;
        b.forEachLegalBuffered([&](const Move& m, const Board& c) { x.push_back(m); cx.push_back(c); });
        b.forEachLegalStreaming([&](const Move& m, const Board& c) { y.push_back(m); cy.push_back(c); });
        if (x.size() != y.size()) { ++diffs; continue; }
        for (size_t i = 0; i < x.size(); ++i) {
            if (!(x[i] == y[i]) || cx[i].fen() != cy[i].fen() || cx[i].fen() != b.applied(x[i]).fen())
                ++diffs;
        }
    }
    CHECK(diffs == 0);
}

static void testBatch() {
    printf("[batch perft (breadth first, threaded)]\n");
    struct Case { const char* fen; int depth; uint64_t expected; };
    const Case cases[] = {
        {nullptr, 4, 197281}, {KIWIPETE, 3, 97862}, {POS3, 5, 674624},
        {POS4, 3, 9467}, {POS5, 3, 62379},
    };
    for (const Case& c : cases) {
        Board b = c.fen ? fromFen(c.fen) : Board::startpos();
        uint64_t n = batch::perftBreadthFirst({b}, c.depth, 4);
        printf("  depth %d: %llu (expected %llu)\n", c.depth, (unsigned long long)n,
               (unsigned long long)c.expected);
        CHECK(n == c.expected);
    }

    // Batch encode/count/expand agree with the scalar functions.
    std::vector<Board> boards = samplePositions();
    const int64_t n = static_cast<int64_t>(boards.size());
    std::vector<float> enc(n * ENCODED_FLOATS), one(ENCODED_FLOATS);
    batch::encode(boards.data(), n, enc.data(), 3);
    int bad = 0;
    for (int64_t i = 0; i < n; ++i) {
        encodeBoard(boards[i], one.data());
        for (int k = 0; k < ENCODED_FLOATS; ++k) bad += enc[i * ENCODED_FLOATS + k] != one[k];
    }
    CHECK(bad == 0);

    std::vector<int32_t> counts(n);
    std::vector<uint8_t> status(n);
    std::vector<int64_t> offsets(n + 1);
    batch::countLegal(boards.data(), n, counts.data(), status.data(), 3);
    const int64_t total = batch::exclusiveScan(counts.data(), n, offsets.data());
    std::vector<Board> kids(total);
    std::vector<Move> moves(total);
    std::vector<int64_t> parent(total);
    batch::expand(boards.data(), n, offsets.data(), kids.data(), moves.data(), parent.data(), 3);
    bad = 0;
    for (int64_t i = 0; i < n; ++i) {
        MoveList ml; boards[i].generateLegal(ml);
        bad += ml.count != counts[i];
        for (int k = 0; k < ml.count; ++k) {
            const int64_t j = offsets[i] + k;
            bad += !(moves[j] == ml.moves[k]) || parent[j] != i ||
                   kids[j].fen() != boards[i].applied(ml.moves[k]).fen();
        }
    }
    CHECK(bad == 0);
    printf("  %lld boards -> %lld children\n", (long long)n, (long long)total);
}

int main(int argc, char** argv) {
    std::vector<Board> positions = samplePositions();
    testSanRoundTrip(positions);
    testSanVariants();
    testTokens();
    testEncoding(positions);
    testStatus();
    testLegalStrategiesAgree(positions);
    testBatch();
    if (argc > 1) {
        for (int i = 1; i < argc; ++i) testPgnFile(argv[i]);
    } else {
        for (const char* p : {"pgns/test.pgn", "pgns/WorldChamp2014.pgn",
                              "pgns/WorldChamp2016.pgn", "pgns/WorldChamp2018.pgn"})
            testPgnFile(p);
    }
    printf("\n%s (%d failures)\n", failures ? "FAILURES" : "ALL PASS", failures);
    return failures ? 1 : 0;
}
