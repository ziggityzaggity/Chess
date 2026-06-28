#ifndef OBJECTS
#define OBJECTS

#include <vector>
#include <array>
#include <unordered_map>
#include <numeric>
#include <memory>
#include <functional>

class Piece;
class Board;
class Move;

using coord = std::pair<int, int>;
using PiecePtr = std::shared_ptr<Piece>;
using WeakPiecePtr = std::weak_ptr<Piece>;

bool checkInBounds(coord pos);

class Piece { 
    public:
    coord currentPosition, startPosition;
    char colour, type;
    bool neverMoved = true;

    Piece(char colour, char type, coord startPosition);
};

class Move {
    public:
    bool first; // if valid move and if this is the piece's first move
    char special, newtype = '\0', check;
    // special is '\0 if none, 'e' if en passent, 'c' if castle, 'u' if upgrade
    // check is '\0' if not, 'c' if check, 'm' if checkmate
    coord start, end;
    WeakPiecePtr content;

    Move(PiecePtr piece, coord move, WeakPiecePtr content, char special = '\0', char check = '\0');
};

class Board {
    public:
    bool inCheck = false;
    char turn = 'w'; // white begins
    std::vector<Move> moves;
    int current = 0; // index of current move
    std::array<std::array<PiecePtr, 8>, 8> state;
    std::vector<Move> moveCache;

    Board();
    PiecePtr operator[](coord square);
    
    /** @brief returns colour of piece in position, else null */
    char isOccupied(coord square);
    /** @brief enacts move on the board*/
    void move(Move move);
    /** @brief checks if the active player is currently in check*/
    bool checkForCheck(bool change);
    /** @brief gets every move for every piece currently on the board */
    std::vector<Move> getAllMoves();
    void changeTurn();
    Move lastMove();
    /** @brief undoes the latest move, use continuously to go backwards through all moves, use with redo() */
    void undo();

    void addMove(Move move);
    /** @brief to prevent illegal or impossible moves from being redone after a move is overrided */
    void clearFutureMoves();
    /** @brief redoes the last undone move, use with undo() */   
    void redo();
    void isMove(coord selected);
    

    std::vector<Move> findMoves(coord square);
    std::vector<Move> pawn(PiecePtr piece, bool test);
    std::vector<Move> rook(PiecePtr piece, bool test);
    std::vector<Move> knight(PiecePtr piece, bool test); 
    std::vector<Move> bishop(PiecePtr piece, bool test);
    std::vector<Move> queen(PiecePtr piece, bool test);
    std::vector<Move> king(PiecePtr piece, bool test);
    /** @brief uses vectors to get all legal moves in a direction, for rook, bishop and queen */
    std::vector<Move> getGenericMoves(coord directions[], int n, PiecePtr piece, bool test);
};

#endif