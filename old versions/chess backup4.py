from copy import copy
import pygame as pg

L = 8 # length of the chess board
PX = 480 # number of pixels long that the height/width of the board is
SQ = 60  # number of pixels high/wide each square is
IMAGES = {}  # dictionary for all the piece textures

def checkInBounds(pos):
    if (pos[0] in range(8)) and (pos[1] in range(8)):
        return True
    else:
        return False

class Piece:
    def __init__(self, colour, ptype, row, column, game):
        self.curpos = (row, column) #current position, to be updated with every move
        self.startpos = self.curpos
        self.colour = colour
        self.type = ptype
        self.neverMoved = True # when initialised, the piece has never been moved, this is to keep track of castling or how many squares a pawn can move
        self.doubleJumped = False
        self.game = game
    def findMoves(self, test):  
        # FMOVES BEGIN
        # does not checkForCheck when test is True, differentiates first and second recursive layers
        # THIS IS WHERE THE PIECES' MOVES ARE CODED
        # IMPORTANT
        game = self.game
        state = game.state
        pmoves = [] # list of possible moves in the form of move classes
        if self.type == "p": # if the piece is a pawn
            # en passent:
            passent = {'w' : {'rs' : 3, 'rv' : 'b', 're' : 2},
                        'b' : {'rs' : 4, 'rv' : 'w', 're' : 5}}
            #rs returns what row you have to start on to be able to en passent, re returns what row you will end at, rv returns the opposite team's colour
            tmp = passent[self.colour]
            if self.curpos[0] == tmp['rs']:  # if the piece is on the correct row to be able to en passent
                for i in range(-1, 2, 2):
                    if game.isOccupied((self.curpos[0], self.curpos[1] + i)) == tmp['rv']:  #if either piece next to this pawn is of the reverse colour
                        sq = state[self.curpos[0]][self.curpos[1] + i]
                        if sq.type == 'p': #if the piece next to this pawn is a pawn
                            if sq.doubleJumped == True:  #if the piece has double jumped
                                if game.lastMove().first and (game.lastMove().start == sq.startpos): # if this piece moved in the last round for the first time using a double jump
                                    pmoves.append(Move(self, (tmp['re'], sq.curpos[1]), special='ep'))
            # end en passent
            d = {'b' : 1, 'w' : -1}  # which direction to move
            c = d[self.colour]
            if self.curpos[0] in [0, 7]:  # if a pawn lands here then it upgrades, can occur with a pawn capture
                spec = 'up'
            else:
                spec = None
            for i in range(-1, 2, 2):  # pawn capturing
                if game.isOccupied((self.curpos[0] + c, self.curpos[1] + i)):
                    pmoves.append(Move(self, (self.curpos[0] + c, self.curpos[1] + i), special=spec))
            if not game.isOccupied((self.curpos[0] + c, self.curpos[1])): # if space in front is empty
                pmoves.append(Move(self, (self.curpos[0] + c, self.curpos[1]), special=spec))
                if self.neverMoved == True: # if pawn has never moved
                    if not game.isOccupied((self.curpos[0] + (c*2), self.curpos[1])):  # if space two in front is empty
                        pmoves.append(Move(self, (self.curpos[0] + (c*2), self.curpos[1]), special='dj'))  # doubleJump, exclusive with capture and with upgrade
        elif self.type == "N": # knight
            l = [(1, 2), (1, -2), (-1, 2), (-1, -2)] 
            for t in l:
                pmoves.append(Move(self, (self.curpos[0] + t[0], self.curpos[1] + t[1])))
                pmoves.append(Move(self, (self.curpos[0] + t[1], self.curpos[1] + t[0])))
        elif self.type == "R": # rook
            pmoves = self.findGenericMoves([(1, 0), (0, 1), (-1, 0), (0, -1)])  # down right up left
        elif self.type == "B": # bishop
            pmoves = self.findGenericMoves([(1, 1), (1, -1), (-1, 1), (-1, -1)]) # down-right down-left up-right up-left
        elif self.type == "Q": # queen
            pmoves = self.findGenericMoves([(1, 1), (1, -1), (-1, 1), (-1, -1), (1, 0), (0, 1), (-1, 0), (0, -1)]) 
            # down-right  down-left  up-right  up-left  down  right  up  left
        elif self.type == "K": # king
            for i in range(-1, 2):
                for j in range(-1, 2):
                    pmoves.append(Move(self, (self.curpos[0] + i, self.curpos[1] + j)))
            # CASTLE:
            if self.neverMoved == True:
                k = 4 # king starts at column 4
                cols = {0 : (2, -1), 7 : (6, 1)}  # where the rook is : (where the king will end up if player castles, how to increment between columns starting from the king ending at a rook
                for key in [0, 7]:  # for rook on either side; left, right
                    mv = cols[key][0]
                    increment = cols[key][1]
                    if game.isOccupied((self.startpos[0], key)) == self.colour:  # if there is a piece currently on the rook's starting position with the same colour as the active player
                        sq = state[self.startpos[0]][key] # sq = rook Piece at column "key" and default row
                        if sq.type == 'R' and sq.neverMoved == True:  #if there is a never-moved rook of the same colour in the rook starting position
                            if key == 0: #if left side
                                if game.isOccupied((self.startpos[0], 1)):  # if square right next to rook is occupied
                                    continue  # move onto next element in for loop, meaning other rook
                            for i in range(k + increment, mv + increment, increment): # for the two squares in either possible direction the king would have to travel in order to castle
                                if game.isOccupied((self.startpos[0], i)):  # if the square is occupied then 
                                    break  # forget about this rook for castling because there is a piece between the king and rook
                                check = game.checkForCheck(self.colour, Move(self, (self.curpos[0], i)))
                                if check: # if one of the moves would put the king in danger
                                    break
                            else:  # this else belongs to the earlier for loop, meaning that it will only execute if the loop finished without breaking, meaning that neither square in the direction of the current rook is occupied or would put the king in danger
                                pmoves.append(Move(self, (self.curpos[0], mv), special='ca'))
            # CASTLE end
            
        fmoves = []
        for move in pmoves:
            if move.valid == False:  # if the move didnt pass the criteria for being legal: in bounds and on empty space or occupied by opposite colour
                pass
            elif test == True:  # if it is the temporary board, that is reversed underneath
                #if it is the second recursive layer, called by checkForCheck
                fmoves.append(move)
            else:  # if it is the first recursive layer, not called by checkForCheck
                check = game.checkForCheck(self.colour, move)
                if check == False:  # meaning that if checkForCheck didnt find anything
                    fmoves.append(move)

        return fmoves;
        ### FINDMOVES END

    def move(self, move):  # moves a piece: adds move to the moves dictionary, updates the board and itself
        state = self.game.state
        self.game.addMove(move)
        nvm = self.neverMoved
        self.neverMoved = False  # identify this piece as having moved
        state[move.end[0]][move.end[1]] = state[self.curpos[0]][self.curpos[1]]  # put the contents of the old square into the new square
        state[self.curpos[0]][self.curpos[1]] = None  # remove the contents of the old square
        self.curpos = move.end  # update piece's internal coordinates for move creation IMPORTANT
        if move.special == 'ep': # if the move is an en passent
            #remove the captured pawn
            state[move.pawn.curpos[0]][move.pawn.curpos[1]] = None
        elif move.special == 'ca': # if the move is a castle
            #move the castled rook
            # put old rook in its new position, column 3 if left and column 5 if right and update it's internal coordinates
            rook_column = {0 : 3, 7 : 5}  # what column the rook ends up in depending on where it began; startpos[1] : curpos[1]
            oldpos = move.rook.startpos
            newcolumn = rook_column[oldpos[1]]  # newcoloumn is 3 if left rook or 5 if left rook
            state[oldpos[0]][newcolumn] = state[oldpos[0]][oldpos[1]]  #  put the rook in the new position
            state[oldpos[0]][newcolumn].curpos = (oldpos[0], newcolumn)  # update internal coordinates
            state[oldpos[0]][newcolumn].neverMoved = False  # update neverMoved
            state[oldpos[0]][oldpos[1]] = None  # empty the rook's old position
        up = {'w' : 0, 'b' : 7}
        if self.curpos[0] == up[self.colour] and self.type == 'p':  # if it is the bottom or top row and the piece is a pawn
            self.type = 'Q'  # upgrade pawn to queen
        what = {'w' : 4, 'b' : 3}
        if nvm == True and self.type == 'p' and self.curpos[0] == what[self.colour]: # if this was the pawn's first move, and matches the row it would be on if it were to double jump given its colour(row 4 for white and row 3 for black)
            self.doubleJumped = True  # identify this pawn as having double jumped and therefore being open to en passent, although only for the next turn
        self.game.clearMoves()

    def findGenericMoves(self, list):  # finds the moves of bishop, rook, and queen
        moves = []
        for t in list: # for direction in list
            for i in range(1, L):
                moves.append(Move(self, (self.curpos[0] + (i*t[0]), self.curpos[1] + (i*t[1]))))
                if self.game.isOccupied((self.curpos[0] + (i*t[0]), self.curpos[1] + (i*t[1]))):
                    break
        return moves




# to initialise the board matrix with all the pieces in the correct position
# creates a standard chess board
def loadBoard(game):
    b = [[None for i in range(L)] for j in range(L)]
    pieces = ["R", "N", "B", "Q", "K", "B", "N", "R"] # order of non-pawn pieces from left to right, from player1 perspective
    for i in [0, 1, 6, 7]:
        tmp = [None]*L
        for j in range(L):
            if i in [0, 1]: # if the piece is in one of the top two rows then the colour is black
                c = 'b'
            elif i in [6, 7]:  # if the piece is in one of the bottow two rows then the colour is white
                c = 'w'
            if i in [1, 6]:  # if the piece is in the second from the top or second from the bottom row then the piece is a pawn
                p = 'p'
            elif i in [0, 7]: # if the piece is in the top or bottom row then the piece type is determined by its location on the pieces list
                p = pieces[j]
            tmp[j] = Piece(c, p, i, j, game)
        b[i] = tmp
    return b;

class Game:
    def __init__(self):
        self.state = loadBoard(self)
        self.turn = 'w'  # meaning that it is white's turn, to be changed after every move between 'w' and 'b'
        self.moves = {}  # all moves made
        self.index = 0  # to see which move the game is on, index // 2 is the round number

    def isOccupied(self, pos):  # returns false if empty or off board, returns colour if populated
        if checkInBounds(pos) == False:
            return False
        if self.state[pos[0]][pos[1]] == None:
            return False
        else:
            return self.state[pos[0]][pos[1]].colour

    def checkForCheck(self, pclr, change = False):  # to determine if player of colour "pclr" will be in check after moving piece at "start" to "move"
        # change moves a piece on the board to determine if doing so would cause check, used by findMoves
        # returns true for check and false for safe
        if change:
            tmp = copy.copy(self.moves)
            self.state[change.start[0]][change.start[1]].move(change)
        d = {'w' : 'b', 'b' : 'w'}
        oclr = d[pclr]
        for i in range(L):
            for j in range(L):  # for every square on the board
                if self.isOccupied((i, j)) == oclr:  # if the square contains a piece of the opposite colour
                    for m in list(map(lambda a : a.end, self.state[i][j].findMoves(True))):  # for every test move that opponent piece has
                        if self.isOccupied(m) == pclr:
                            if self.state[m[0]][m[1]].type == 'K':  # if a piece that can be captured is the player's king
                                if change:
                                    self.undo()
                                    self.moves = tmp
                                return True  # indicating that this move will put you in check
        if change:
            self.undo()
            self.moves = tmp
        return False  # indicating this move will not put you in check, if no opponent piece can capture your king

    def getAllMoves(self, clr):  # get every possible move for one colour
        moves = []
        for i in range(L):
            for j in range(L):
                if self.isOccupied((i, j)) == clr:
                    moves.append(self.state[i][j].findMoves(False))
        return moves

    def changeTurn(self):  # change whose turn it is
        d = {'w' : 'b', 'b' : 'w'}
        self.turn = d[self.turn]
    
    def lastMove(self):  # get the last move
        return self.moves[self.index - 1]
    
    def undo(self):  # undo the last move
        move = self.lastMove()
        state = self.state
        state[move.start[0]][move.start[1]] = state[move.end[0]][move.end[1]] # move the moved piece back
        if move.special == 'ep':  # en passent
            state[move.pawn.curpos[0]][move.pawn.curpos[1]] = move.pawn  # put the captured pawn back at its original coordinates
        elif move.special == 'ca':  # castle
            state[move.rook.startpos[0]][move.rook.startpos[1]] = state[move.rook.curpos[0]][move.rook.curpos[1]]  # move the rook to its starting position
            state[move.rook.curpos[0]][move.rook.curpos[1]] = None  # remove rook from moved position
            move.rook.curpos = move.rook.startpos
            move.rook.neverMoved = True
        state[move.end[0]][move.end[1]] = move.content
        state[move.start[0]][move.start[1]].curpos = move.start  # change back the internal coordinates of the piece
        state[move.start[0]][move.start[1]].neverMoved = move.first  # restore the original nevermoved status of the piece
        state[move.start[0]][move.start[1]].type = move.otype  # restore original piece type, in the event of an upgrade
        if move.otype == 'p': #if moved piece was a pawn
            state[move.start[0]][move.start[1]].doubleJumped = move.dj  # restore doubleJumped value
        self.index -= 1


    def addMove(self, m):  # add another move to the dictionary
        self.moves[self.index] = m
        self.index += 1

    def clearMoves(self):
        #removes moves from the moves dictionary that are ahead of the current index so that a player cant accidentally redo a move they werent supposed to, makes you unable to redo after moving
        hi = len(self.moves) - 1 # highest index in the dictionary
        while self.index <= hi:
            self.moves.pop(hi)
            hi -= 1

    def redo(self):
        if not len(self.moves) >= self.index + 1:
            return False
        move = self.moves[self.index]
        tmp = copy.copy(self.moves)
        self.state[move.start[0]][move.start[1]].move(move)
        self.moves = tmp

    
    def drawPieces(self, screen):
        for i in range(L):
            for j in range(L):
                try:
                    screen.blit(IMAGES[(self.state[i][j].colour + self.state[i][j].type)], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                except:
                    pass

    def drawScreen(self, screen, *args):
        screen.fill(pg.Color("white"))
        try:
            drawBoard(screen, list(map(lambda a : a.end, args[0])), args[1])
        except:
            drawBoard(screen)
        self.drawPieces(screen)
        pg.display.flip()

    def isMove(self, selected, move):  # determines if the selected piece can move to the desired square, returns false if no and the move if yes
        for m in self.state[selected[0]][selected[1]].findMoves(False):
            if m.end == move:
                return m
        return False

def loadImages():
    ls = ["R", "N", "B", "Q", "K", "p"]
    for p in ls:
        blackP = "b" + p
        whiteP = "w" + p
        try:
            IMAGES[blackP] = pg.image.load("images/" + blackP + ".png")
            IMAGES[whiteP] = pg.image.load("images/" + whiteP + ".png")
        except:
            IMAGES[blackP] = pg.image.load("chess/images/" + blackP + ".png")
            IMAGES[whiteP] = pg.image.load("chess/images/" + whiteP + ".png")

def drawBoard(screen, *args):
    try:
        squares = args[0]
        p = args[1]
        for i in range(L):
            for j in range(L):
                if (i, j) == p:
                    pg.draw.rect(screen, pg.Color("yellow"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
                elif (i, j) in squares:
                    pg.draw.rect(screen, pg.Color("green"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
                elif ((i + j) % 2) == 0:
                    pg.draw.rect(screen, pg.Color("white"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
                else:
                    pg.draw.rect(screen, pg.Color("gray"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
    except:
        for i in range(L):
            for j in range(L):
                if ((i + j) % 2) == 0:
                    pg.draw.rect(screen, pg.Color("white"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
                else:
                    pg.draw.rect(screen, pg.Color("gray"), pg.Rect(j*SQ, i*SQ, SQ, SQ))
    return


class Move:
    def __init__(self, piece, move, special = None):
        if (not checkInBounds(move)) or (move == piece.curpos) or (piece.game.isOccupied(move) == piece.colour):
            self.valid = False
            return
        else:
            self.valid = True
        self.colour = piece.colour  # piece's colour
        self.first = piece.neverMoved  # true if it is the piece's first move, to restore the piece's neverMoved value if game.undo()
        self.start = piece.curpos  # where the piece moved from
        self.end = move  # where the piece moved to
        self.otype = piece.type  # the original type for the piece that was moved, for when pawns get upgraded
        self.content = piece.game.state[move[0]][move[1]]  # what was contained in the square that the piece moved into
        self.special = special
        self.dj = piece.doubleJumped
        if special == 'ep':
            d = {'w' : 1, 'b' : -1}
            self.pawn = piece.game.state[self.end[0] + d[self.colour]][self.end[1]]
        elif special == 'ca':
            c = {2 : 0, 6 : 7}
            self.rook = piece.game.state[self.end[0]][c[self.end[1]]]


def main():
    BOARD = Game()  # the actual chess board, just a matrix/2d list
    pg.init()
    screen = pg.display.set_mode((PX, PX))
    loadImages()  # only called once
    BOARD.drawScreen(screen)
    running = True
    selected = None
    while running:
        for event in pg.event.get():
        # Check for QUIT event      
            if event.type == pg.QUIT:
                running = False
            elif event.type == pg.MOUSEBUTTONDOWN:
                if event.button == 3:
                    selected = None
                    BOARD.drawScreen(screen)
                c = event.pos[0] // SQ
                r = event.pos[1] // SQ
                if selected == None: # if no square is selected
                    if BOARD.isOccupied((r, c)) == BOARD.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        BOARD.drawScreen(screen, BOARD.state[r][c].findMoves(False), (r, c))
                else:
                    move = BOARD.isMove(selected, (r, c))  # determines if a move is legal for the selected piece, returns false if not and the move if yes
                    if move:  # THIS IS WHERE THE PLAYER MOVES THEIR PIECES
                        BOARD.state[selected[0]][selected[1]].move(move)  # only move if the piece you already have selected can move to the new square you have selected
                        selected = None
                        BOARD.changeTurn()
                        BOARD.drawScreen(screen)
                        ch = {'b' : "BLACK", 'w' : "WHITE"}
                        if len(BOARD.getAllMoves(BOARD.turn)) == 0:  # if the new active player has no moves
                            if BOARD.checkForCheck(BOARD.turn):  # if the newly active player is in check, meaning that they got checkmated
                                #CHECKMATE
                                print(ch[BOARD.turn] + "HAS BEEN CHECKMATED")
                            else:
                                #STALEMATE
                                print("STALEMATE")
                        elif BOARD.checkForCheck(BOARD.turn):
                            #CHECK
                            print(ch[BOARD.turn] + "HAS BEEN CHECKED")

                    elif (r, c) == selected:
                        selected = None
                        BOARD.drawScreen(screen)
                    elif BOARD.isOccupied((r, c)) == BOARD.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        BOARD.drawScreen(screen, BOARD.state[r][c].findMoves(False), (r, c))
                    else:
                        selected = None
                        BOARD.drawScreen(screen)
            elif event.type == pg.KEYDOWN:
                if event.key == pg.K_BACKSPACE:  # if backspace is pressed, undo last move
                    try:
                        BOARD.undo()
                        BOARD.changeTurn()
                        BOARD.drawScreen(screen)
                        selected = None
                    except:
                        pass
                elif event.key == pg.K_TAB:  # if tab is pressed
                    if BOARD.redo() == False:
                        continue
                    BOARD.changeTurn()
                    BOARD.drawScreen(screen)
                    selected = None
                

        


if __name__ == "__main__":
    main()