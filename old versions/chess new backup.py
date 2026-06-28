import pygame as pg

L = 8 # length of the chess board
ROWS = [1, 2, 3, 4, 5, 6, 7, 8] # ranks, pos[0]
COLS = ["a", "b", "c", "d", "e", "f", "g", "h"] # files, pos[1]
PGN = f"" # for writing pgn files to save games
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
        pmoves = [] # list of possible moves in the form of tuples indicating where the piece can go
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
                                    pmoves.append((tmp['re'], sq.curpos[1]))
            # end en passent
            d = {'b' : 1, 'w' : -1}
            c = d[self.colour]
            for i in range(-1, 2, 2):  # pawn capturing
                if game.isOccupied((self.curpos[0] + c, self.curpos[1] + i)):
                    pmoves.append((self.curpos[0] + c, self.curpos[1] + i))
            if not game.isOccupied((self.curpos[0] + c, self.curpos[1])): # if space in front is empty
                pmoves.append((self.curpos[0] + c, self.curpos[1]))
                if self.neverMoved == True: # if pawn has never moved
                    if not game.isOccupied((self.curpos[0] + (c*2), self.curpos[1])):  # if space two in front is empty
                        pmoves.append((self.curpos[0] + (c*2), self.curpos[1]))
        elif self.type == "N": # knight
            l = [(1, 2), (1, -2), (-1, 2), (-1, -2)] # down-right down-left up-right up-left
            for t in l:
                pmoves.append((self.curpos[0] + t[0], self.curpos[1] + t[1]))
                pmoves.append((self.curpos[0] + t[1], self.curpos[1] + t[0]))
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
                    pmoves.append((self.curpos[0] + i, self.curpos[1] + j))
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
                                self.move((self.curpos[0], i))
                                check = game.checkForCheck(self.colour)
                                game.undo()
                                if check: # if one of the moves would put the king in danger
                                    break
                            else:  # this else belongs to the earlier for loop, meaning that it will only execute if the loop finished without breaking, meaning that neither square in the direction of the current rook is occupied or would put the king in danger
                                pmoves.append((self.curpos[0], mv))
            # CASTLE end
            
        fmoves = []
        for move in pmoves:
            #make sure that the piece cannot move off the board, to its current position, to the position of a piece with the same colour
            if move == self.curpos: # if move leads to current position
                pass
            elif checkInBounds(move) == False: # if move leads out of bounds
                pass
            elif game.isOccupied(move) == self.colour: # if move leads to space containing piece with same colour
                pass
            elif test == True:  # if it is the temporary board, that is reversed underneath
                #if it is the second recursive layer, called by checkForCheck
                fmoves.append(move)
            else:  # if it is the first recursive layer, not called by checkForCheck
                self.move(move)
                check = game.checkForCheck(self.colour)
                game.undo()
                if check == False:  # meaning that if checkForCheck didnt find anything
                    fmoves.append(move)

        return fmoves;
        ### FINDMOVES END

    def move(self, move):  # moves a piece: adds move to the moves dictionary, updates the board and itself
        state = self.game.state
        self.game.addMove(Move(self.colour, self.type, self.neverMoved, self.curpos, move, self.game, self.doubleJumped))
        nvm = self.neverMoved
        self.neverMoved = False  # identify this piece as having moved
        state[move[0]][move[1]] = state[self.curpos[0]][self.curpos[1]]  # put the contents of the old square into the new square
        state[self.curpos[0]][self.curpos[1]] = None  # remove the contents of the old square
        self.curpos = move  # update piece's internal coordinates for move creation IMPORTANT
        try:
            lastmove = self.game.lastMove()
            if lastmove.special == 'ep': # if the move is an en passent
                #remove the captured pawn
                state[lastmove.pawn.curpos[0]][lastmove.pawn.curpos[1]] = None
            elif lastmove.special == 'ca': # if the move is a castle
                #move the castled rook
                # put old rook in its new position, column 3 if left and column 5 if right and update it's internal coordinates
                rook_column = {0 : 3, 7 : 5}  # what column the rook ends up in depending on where it began; startpos[1] : curpos[1]
                oldpos = lastmove.rook.startpos
                newcolumn = rook_column[oldpos[1]]  # newcoloumn is 3 if left rook or 5 if left rook
                state[oldpos[0]][newcolumn] = state[oldpos[0]][oldpos[1]]  #  put the rook in the new position
                state[oldpos[0]][newcolumn].curpos = (oldpos[0], newcolumn)  # update internal coordinates
                state[oldpos[0]][newcolumn].neverMoved = False  # update neverMoved
                state[oldpos[0]][oldpos[1]] = None  # empty the rook's old position
        except:
            pass
        if (self.curpos[0] in [0, 7]) and self.type == 'p':  # if it is the bottom or top row and the piece is a pawn
            self.type = 'Q'  # upgrade pawn to queen
        if self.type == 'p':
            self.game.lastMove().dj = self.doubleJumped
        what = {'w' : 4, 'b' : 3}
        if nvm == True and self.type == 'p' and self.curpos[0] == what[self.colour]: # if this was the pawn's first move, and matches the row it would be on if it were to double jump given its colour(row 4 for white and row 3 for black)
            self.doubleJumped = True  # identify this pawn as having double jumped and therefore being open to en passent, although only for the next turn

    def findGenericMoves(self, list):  # finds the moves of bishop, rook, and queen
        moves = []
        for t in list: # for direction in list
            for i in range(1, L):
                moves.append((self.curpos[0] + (i*t[0]), self.curpos[1] + (i*t[1])))
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

    def checkForCheck(self, pclr):  # to determine if player of colour "pclr" will be in check after moving piece at "start" to "move"
        #returns true for check and false for safe
        d = {'w' : 'b', 'b' : 'w'}
        oclr = d[pclr]
        for i in range(L):
            for j in range(L):  # for every square on the board
                if self.isOccupied((i, j)) == oclr:  # if the square contains a piece of the opposite colour
                    for m in self.state[i][j].findMoves(True):  # for every test move that opponent piece has
                        if self.isOccupied(m) == pclr:
                            if self.state[m[0]][m[1]].type == 'K':  # if a piece that can be captured is the player's king
                                return True  # indicating that this move will put you in check
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
        try:
            if move.special == 'ep':  # en passent
                state[move.pawn.curpos[0]][move.pawn.curpos[1]] = move.pawn  # put the captured pawn back at its original coordinates
            elif move.special == 'ca':  # castle
                state[move.rook.startpos[0]][move.rook.startpos[1]] = state[move.rook.curpos[0]][move.rook.curpos[1]]  # move the rook to its starting position
                state[move.rook.curpos[0]][move.rook.curpos[1]] = None  # remove rook from moved position
                move.rook.curpos = move.rook.startpos
                move.rook.neverMoved = True
        except:
            pass
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

    def clearMoves(self):  # deprecated
        #removes moves from the moves dictionary that are ahead of the current index so that a player cant accidentally redo a move they werent supposed to, makes you unable to redo after moving
        hi = len(self.moves) - 1 # highest index in the dictionary
        while self.index < hi:
            self.moves[hi]
            hi -= 1

    def redo(self):  # deprecated
        move = self.lastMove()
        self.index += 1
        
    
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
            drawBoard(screen, args[0], args[1])
        except:
            drawBoard(screen)
        self.drawPieces(screen)
        pg.display.flip()

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
    try:  # if optional arguments are provided then it highlights the proper squares in colours other than the default
        squares = args[0]
        p = args[1]
        for i in range(L):
            for j in range(L):
                if (i, j) == p:
                    pg.draw.rect(screen, pg.Color("yellow"), pg.Rect(j*SQ, i*SQ, SQ, SQ))   # the square containing the chosen piece is highlighted yellow
                elif (i, j) in squares:
                    pg.draw.rect(screen, pg.Color("green"), pg.Rect(j*SQ, i*SQ, SQ, SQ))  # the squares where the pieces can move are highlighted green
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
    def __init__(self, clr, type, firstmove, fromhere, tohere, game, dj):
        self.colour = clr  # piece's colour
        self.first = firstmove  # true if it is the piece's first move, to restore the piece's neverMoved value if game.undo()
        self.start = fromhere  # where the piece moved from
        self.end = tohere  # where the piece moved to
        self.dj = dj
        self.otype = type  # the original type for the piece that was moved, for when pawns get upgraded
        self.content = game.state[tohere[0]][tohere[1]]  # what was contained in the square that the piece moved into
        if self.otype == 'p' and self.content == None and fromhere[1] != tohere[1] and (tohere[0] in [2, 5]):
            # if the moving piece is a pawn, it is moving to a square containing no piece, is moving to a square in a different column and is moving to a 
            # the pawn can only switch columns if it is capturing a piece, either directly(by moving onto its square) or by en passent
            self.special = 'ep'  #en passent
            d = {'w' : 1, 'b' : -1}
            n = d[clr]
            self.pawn = game.state[tohere[0] + n][tohere[1]]
        elif self.otype == 'K' and self.content == None and firstmove == True and fromhere[0] == tohere[0] and fromhere[1] == 4 and (tohere[1] in [2, 6]):
            # if the moving piece is a king, it is moving to a square containing nothing, it is moving for the first time, it is moving from its starting position at column 4 to either column 2 or 6, it is on the same row
            # the king can only move one pace in any direction, except when castling when it moves two paces left or right
            self.special = 'ca' # castle
            if tohere[1] == 2:
                n = 0  # row of left rook
            else: # if it is 6
                n = 7  # row of right rook
            self.rook = game.state[fromhere[0]][n]


def main():
    board = Game()  # the actual chess board, just a matrix/2d list
    pg.init()
    screen = pg.display.set_mode((PX, PX))
    loadImages()  # only called once
    board.drawScreen(screen)
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
                    board.drawScreen(screen)
                c = event.pos[0] // SQ
                r = event.pos[1] // SQ
                if selected == None: # if no square is selected
                    if board.isOccupied((r, c)) == board.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        board.drawScreen(screen, board.state[r][c].findMoves(False), (r, c))
                else:
                    if (r, c) in board.state[selected[0]][selected[1]].findMoves(False):  # THIS IS WHERE THE PLAYER MOVES THEIR PIECES
                        board.state[selected[0]][selected[1]].move((r, c))  # only move if the piece you already have selected can move to the new square you have selected
                        selected = None
                        board.changeTurn()
                        board.drawScreen(screen)
                        if len(board.getAllMoves(board.turn)) == 0:  # if the new active player has no moves
                            if board.checkForCheck(board.turn):  # if the newly active player is in check, meaning that they got checkmated
                                #CHECKMATE
                                pass
                            else:
                                #STALEMATE
                                pass
                    elif (r, c) == selected:
                        selected = None
                        board.drawScreen(screen)
                    elif board.isOccupied((r, c)) == board.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        board.drawScreen(screen, board.state[r][c].findMoves(False), (r, c))
                    else:
                        selected = None
                        board.drawScreen(screen)
            elif event.type == pg.KEYDOWN:
                if event.key == pg.K_BACKSPACE:  # if backspace is pressed, undo last move
                    try:
                        board.undo()
                        board.changeTurn()
                        board.drawScreen(screen)
                        selected = None
                    except:
                        pass
                

if __name__ == "__main__":
    main()