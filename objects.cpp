#include "objects.hpp"
#include <iostream>


bool checkInBounds(coord pos) {
    return 
    (0 <= std::min(pos.first, pos.second) &&
     8 > std::max(pos.first, pos.second));
}

// Piece:
    Piece::Piece(char clr, char ptype, int row, int column) {
        curpos = {row, column};
        startpos = curpos;
        colour = clr;
        type = ptype;
    }
//end Piece

// Board:
    Board::Board() {
        const char order[] = {'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'};
        for (int i : {0, 1, 6, 7}) {
            for (int j = 0; j < 8; j++) {
                char colour, type;
                if (i == 0 || i == 1)
                    colour = 'b';
                else 
                    colour = 'w';
                if (i == 1 || i == 6) 
                    type = 'p';
                else 
                    type = order[j];
                Piece piece = Piece(colour, type, i, j);
                state[i][j] = std::make_shared<Piece>(piece);
            }
        }
    }
    
    PiecePtr Board::operator[](coord square) {
        // subscript operator overload
        return state[square.first][square.second];
    }

    char Board::isOccupied(coord square) {
    
        if ((*this)[square] == nullptr)
            return '\0';
        return (*this)[square]->colour;
    }

    std::vector<Move> Board::findMoves(coord square) {
        using functionPointer = std::function<std::vector<Move>(Board*, PiecePtr, bool)>;
        static std::unordered_map<char, functionPointer> find = {{'R', &Board::rook}, {'K', &Board::knight}, {'B', &Board::bishop}, {'Q', &Board::queen}, {'K', &Board::king}, {'p', &Board::pawn}};
        PiecePtr piece = (*this)[square];
        functionPointer fp = find[piece->type];
        return fp(this, piece, false);
    }
// end Board

// Move:
    Move::Move(PiecePtr piece, coord move, WeakPiecePtr conten, char spec, char chek) {
        first = piece->neverMoved;
        start = piece->curpos;
        end = move;
        special = spec;
        check = chek;
        content = conten;
        /*// validity check:
        if ((!checkInBounds(move)) || 
        (move == piece->curpos) || 
        (piece->game->isOccupied(move) == piece->colour)) {
            bool valid = false;
            return;
        }
        // special move handling:
        if (special == 'e') { //en passent
            int index = (colour == 'w' ? 1 : -1);
            content = (*game)[{end.first+index, end.second}];
        }
        else if (special == 'c') { //castle
            int index = (end.second == 2 ? 0 : 7);
            content = (*game)[{end.first, index}];
        }
        else 
            content = (*game)[move];*/
        
    }
// end Move
