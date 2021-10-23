from copy import copy
import pygame as pg
from parse import search

L = 8  # length of the chess board
PX = 480  # number of pixels long that the height/width of the board is
SQ = PX // L  # number of pixels high/wide each square is


def checkInBounds(pos):
    # checks if a square can exist on the board
    if (pos[0] in range(L)) and (pos[1] in range(L)):
        return True
    else:
        return False


class Piece:
    def __init__(self, colour, ptype, row, column, game):
        self.curpos = (row, column)  # current position, to be updated with every move
        self.startpos = self.curpos  # starting position
        self.colour = colour
        self.type = ptype
        self.neverMoved = True  # when initialised, the piece has never been moved, this is to keep track of castling or how many squares a pawn can move
        self.game = game  # reference to the game to which it belongs

    def findMoves(self, test):
        # FMOVES BEGIN
        # does not checkForCheck when test is True, differentiates first and second recursive layers
        # THIS IS WHERE THE PIECES' MOVES ARE CODED
        # IMPORTANT
        game = self.game
        pmoves = []  # list of possible moves in the form of move classes
        if self.type == "p":  # if the piece is a pawn
            # en passent:
            passent = {'w': {'rs': 3, 'rv': 'b', 're': 2},
                       'b': {'rs': 4, 'rv': 'w', 're': 5}}
            # rs returns what row you have to start on to be able to en passent, re returns what row you will end at, rv returns the opposite team's colour
            tmp = passent[self.colour]
            if self.curpos[0] == tmp['rs']:  # if the piece is on the correct row to be able to en passent
                for i in range(-1, 2, 2):
                    # if either piece next to this pawn is of the reverse colour
                    if game.isOccupied((self.curpos[0], self.curpos[1] + i)) == tmp['rv']:
                        sq = game[self.curpos[0]][self.curpos[1] + i]
                        lm = game.lastMove()
                        if sq.type == 'p':  # if the piece next to this pawn is a pawn
                            # if the lastmove was a doublejump that lead to the square next to this pawn
                            if lm.special == 'dj' and (lm.end == sq.curpos):
                                pmoves.append(Move(self, (tmp['re'], sq.curpos[1]), special='ep'))
            # end en passent
            d = {'b': 1, 'w': -1}  # which direction to move
            c = d[self.colour]
            spec = None
            if (self.curpos[0] + c) in [0, 7]:  # if a pawn lands here then it upgrades, can occur with a pawn capture
                spec = 'up'
            for i in range(-1, 2, 2):  # pawn capturing
                if game.isOccupied((self.curpos[0] + c, self.curpos[1] + i)):
                    pmoves.append(Move(self, (self.curpos[0] + c, self.curpos[1] + i), special=spec))
            if not game.isOccupied((self.curpos[0] + c, self.curpos[1])):  # if space in front is empty
                pmoves.append(Move(self, (self.curpos[0] + c, self.curpos[1]), special=spec))
                if self.neverMoved == True:  # if pawn has never moved
                    if not game.isOccupied((self.curpos[0] + (c*2), self.curpos[1])):  # if space two in front is empty
                        # doubleJump, exclusive with capture and with upgrade
                        pmoves.append(Move(self, (self.curpos[0] + (c*2), self.curpos[1]), special='dj'))
        elif self.type == "N":  # knight
            l = [(1, 2), (1, -2), (-1, 2), (-1, -2)]
            for t in l:
                pmoves.append(Move(self, (self.curpos[0] + t[0], self.curpos[1] + t[1])))
                pmoves.append(Move(self, (self.curpos[0] + t[1], self.curpos[1] + t[0])))
        elif self.type == "R":  # rook
            pmoves = self.findGenericMoves([(1, 0), (0, 1), (-1, 0), (0, -1)])  # down right up left
        elif self.type == "B":  # bishop
            pmoves = self.findGenericMoves([(1, 1), (1, -1), (-1, 1), (-1, -1)])  # down-right down-left up-right up-left
        elif self.type == "Q":  # queen
            pmoves = self.findGenericMoves([(1, 1), (1, -1), (-1, 1), (-1, -1), (1, 0), (0, 1), (-1, 0), (0, -1)])
            # down-right  down-left  up-right  up-left  down  right  up  left
        elif self.type == "K":  # king
            for i in range(-1, 2):
                for j in range(-1, 2):
                    pmoves.append(Move(self, (self.curpos[0] + i, self.curpos[1] + j)))
            # castle:
            if self.neverMoved == True:
                k = 4  # king starts at column 4
                # where the rook is : (where the king will end up if player castles, how to increment between columns starting from the king ending at a rook
                cols = {0: (2, -1), 7: (6, 1)}
                for key in [0, 7]:  # for rook on either side; left, right
                    mv = cols[key][0]
                    increment = cols[key][1]
                    # if there is a piece currently on the rook's starting position with the same colour as the active player
                    if game.isOccupied((self.startpos[0], key)) == self.colour:
                        sq = game[self.startpos[0]][key]  # sq = rook Piece at column "key" and default row
                        if sq.type == 'R' and sq.neverMoved == True:  # if there is a never-moved rook of the same colour in the rook starting position
                            if key == 0:  # if left side
                                if game.isOccupied((self.startpos[0], 1)):  # if square right next to rook is occupied
                                    continue  # move onto next element in for loop, meaning other rook
                                # for the two squares in either possible direction the king would have to travel in order to castle
                            for i in range(k + increment, mv + increment, increment):
                                if game.isOccupied((self.startpos[0], i)):  # if the square is occupied then
                                    break  # forget about this rook for castling because there is a piece between the king and rook
                                check = game.checkForCheck(self.colour, Move(self, (self.curpos[0], i)))
                                # This checkForCheck executes regardless of the test state but does not create endless recursion
                                # because each king can only move once and this checkForCheck moves the king on the hypothetical board
                                if check:  # if one of the moves would put the king in danger
                                    break
                            else:
                                # this else belongs to the earlier for loop, meaning that it will only execute if the loop finished without breaking,
                                # meaning that neither square in the direction of the current rook is occupied or would put the king in danger
                                pmoves.append(Move(self, (self.curpos[0], mv), special='ca'))
            # castle end
        fmoves = []
        for move in pmoves:
            if move.valid == False:  # if the move didnt pass the criteria for being legal: in bounds and on empty space or occupied by opposite colour
                pass
            elif test == True:  # if it is the temporary board, that is reversed underneath
                # if it is the second recursive layer, called by checkForCheck
                fmoves.append(move)
            else:  # if it is the first recursive layer, not called by checkForCheck
                check = game.checkForCheck(self.colour, move)
                if check == False:  # meaning that if checkForCheck didnt find anything
                    fmoves.append(move)
        return fmoves
        # FINDMOVES END

    def move(self, move):  # moves a piece: adds move to the moves dictionary, updates the board and itself
        game = self.game
        self.game.addMove(move)
        self.neverMoved = False  # identify this piece as having moved
        # put the contents of the old square into the new square
        game[move.end] = game[self.curpos]
        game[self.curpos] = None  # remove the contents of the old square
        self.curpos = move.end  # update piece's internal coordinates for move creation IMPORTANT
        if move.special == 'ep':  # if the move is an en passent
            # remove the captured pawn
            game[move.pawn.curpos] = None
        elif move.special == 'ca':  # if the move is a castle
            # move the castled rook
            # put old rook in its new position, column 3 if left and column 5 if right and update it's internal coordinates
            rook_column = {0: 3, 7: 5}  # what column the rook ends up in depending on where it began; startpos[1] : curpos[1]
            oldpos = move.rook.startpos
            newpos = (oldpos[0], rook_column[oldpos[1]])  # new coloumn is 3 if left rook or 5 if left rook
            game[newpos] = game[oldpos]  # put the rook in the new position
            game[newpos].curpos = newpos  # update internal coordinates
            game[newpos].neverMoved = False  # update neverMoved
            game[oldpos] = None  # empty the rook's old position
        elif move.special == 'up':  # if it is the bottom or top row and the piece is a pawn
            self.type = 'Q'  # upgrade pawn to queen
            # if this was the pawn's first move, and matches the row it would be on if it were to double jump given its colour(row 4 for white and row 3 for black)
        game.clearMoves()  # cannot redo any further moves, so as to prevent impossible moves

    def findGenericMoves(self, list):  # finds the moves of bishop, rook, and queen
        moves = []
        for t in list:  # for direction in list
            for i in range(1, L):
                moves.append(Move(self, (self.curpos[0] + (i*t[0]), self.curpos[1] + (i*t[1]))))
                if self.game.isOccupied((self.curpos[0] + (i*t[0]), self.curpos[1] + (i*t[1]))):
                    break
        return moves


class Game:
    def __init__(self):
        self.turn = 'w'  # meaning that it is white's turn, to be changed after every move between 'w' and 'b'
        self.moves = {}  # all moves made
        self.index = 0  # to see which move the game is on, index // 2 is the round number
        self.end = None

    def start(self):
        self.loadBoard()
        self.loadColours()
        self.loadImages()
    
    def __getitem__(self, index):
        if type(index) == type((0, )):  # tuple
            return self.state[index[0]][index[1]]
        elif type(index) == type(0):  # int
            return self.state[index]
        else:
            raise TypeError
    
    def __setitem__(self, index, value):
        if type(index) == type((0, )):  # tuple
            self.state[index[0]][index[1]] = value
        else:
            raise TypeError

    def findMoves(self, selected, test):  # easier way to call a piece's findmoves function
        return self.state[selected].findMoves(test)

    def move(self, selected, move):  # easier way to call a piece's move funtion
        self.state[selected].move(move)

    def isOccupied(self, pos):  # returns false if empty or off board, returns colour if populated
        if checkInBounds(pos) == False:
            return False
        if self[pos] == None:
            return False
        else:
            return self[pos].colour

    def loadBoard(self):
        # to initialise the board matrix with all the pieces in the correct position
        # creates a standard chess board
        b = [[None for i in range(L)] for j in range(L)]
        pieces = ["R", "N", "B", "Q", "K", "B", "N", "R"]  # order of non-pawn pieces from left to right, from player1 perspective
        for i in [0, 1, 6, 7]:
            tmp = [None]*L
            for j in range(L):
                if i in [0, 1]:  # if the piece is in one of the top two rows then the colour is black
                    c = 'b'
                elif i in [6, 7]:  # if the piece is in one of the bottow two rows then the colour is white
                    c = 'w'
                if i in [1, 6]:  # if the piece is in the second from the top or second from the bottom row then the piece is a pawn
                    p = 'p'
                elif i in [0, 7]:  # if the piece is in the top or bottom row then the piece type is determined by its location on the pieces list
                    p = pieces[j]
                tmp[j] = Piece(c, p, i, j, self)
            b[i] = tmp
        self.state = b

    def checkForCheck(self, pclr, change=False):  # to determine if player of colour "pclr" will be in check after moving piece at "start" to "move"
        # change moves a piece on the board to determine if doing so would cause check, used by findMoves
        # returns true for check and false for safe
        if change:  # the change kwarg takes a move variable, which gets made to determine if that move would cause check
            # save moves list to make sure that checkForCheck does not allow piece.move() to prevent more redos if possible
            tmp = copy(self.moves)
            # change the board by making the move in order to determine if this potential state is valid
            self[change.start].move(change)
        d = {'w': 'b', 'b': 'w'}
        oclr = d[pclr]
        for i in range(L):
            for j in range(L):  # for every square on the board
                if self.isOccupied((i, j)) == oclr:  # if the square contains a piece of the opposite colour
                    # for every test move that opponent piece has
                    for m in list(map(lambda a: a.end, self[i][j].findMoves(True))):
                        if self.isOccupied(m) == pclr:
                            if self[m].type == 'K':  # if a piece that can be captured is the player's king
                                if change:
                                    self.undo()  # undo earlier made move
                                    self.moves = tmp  # restore moves list
                                return True  # indicating that this move will put you in check
        if change:
            self.undo()  # undo earlier made move
            self.moves = tmp  # restore moves list
        return False  # indicating this move will not put you in check, if no opponent piece can capture your king

    def getAllMoves(self, clr):  # get every possible move for one colour
        moves = []
        for i in range(L):
            for j in range(L):
                if self.isOccupied((i, j)) == clr:
                    for move in self[i][j].findMoves(False):
                        moves.append(move)
        return moves

    def changeTurn(self):  # change whose turn it is
        d = {'w': 'b', 'b': 'w'}
        self.turn = d[self.turn]

    def lastMove(self):  # get the last move
        return self.moves[self.index - 1]

    def undo(self):  # undo the last move
        move = self.lastMove()
        self[move.start] = self[move.end]  # move the moved piece back
        if move.special == 'ep':  # en passent
            self[move.pawn.curpos] = move.pawn  # put the captured pawn back at its original coordinates
        elif move.special == 'ca':  # castle
            self[move.rook.startpos] = self[move.rook.curpos]  # move the rook to its starting position
            self[move.rook.curpos] = None  # remove rook from moved position
            move.rook.curpos = move.rook.startpos
            move.rook.neverMoved = True
        elif move.special == 'up':  # upgrade
            self[move.start[0]][move.start[1]].type = 'p'
        self[move.end] = move.content  # put back on the captured square what was previously at the position
        self[move.start].curpos = move.start  # change back the internal coordinates of the piece
        self[move.start].neverMoved = move.first  # restore the original nevermoved status of the piece
        self.index -= 1

    def addMove(self, m):  # add another move to the dictionary, only used by move()
        self.end = None
        self.moves[self.index] = m
        self.index += 1

    def clearMoves(self):
        # removes moves from the moves dictionary that are ahead of the current index so that a player
        # cant accidentally redo a move they werent supposed to, makes you unable to redo after moving
        hi = len(self.moves) - 1  # highest index in the dictionary
        while self.index <= hi:
            self.moves.pop(hi)
            hi -= 1

    def redo(self):  # allows you to move backwards/forwards through a game when used with undo, moving a piece will prevent further redos
        if not len(self.moves) >= self.index + 1:
            return False
        move = self.moves[self.index]
        tmp = copy(self.moves)
        self[move.start].move(move)
        self.moves = tmp

    def drawPieces(self, screen):  # put the images of the pieces onto the screen at the correct locations
        for i in range(L):
            for j in range(L):
                try:
                    screen.blit(self.images[(self[i][j].colour + self[i][j].type)], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                except AttributeError:
                    pass

    def drawScreen(self, screen, *args):  # calls all the functions necessary to draw/redraw the screen
        screen.fill(pg.Color("white"))
        try:
            self.drawBoard(screen, list(map(lambda a: a.end, args[0])), args[1])
        except IndexError:
            self.drawBoard(screen)
        self.drawPieces(screen)
        pg.display.flip()

    def isMove(self, selected, move):  # determines if the selected piece can move to the desired square, returns false if no and the move if yes
        for m in self[selected].findMoves(False):
            if m.end == move:
                return m
        return False

    def loadImages(self):  # load all of the image textures into memory
        ls = ["R", "N", "B", "Q", "K", "p"]
        img = {}
        for p in ls:
            blackP = "b" + p
            whiteP = "w" + p
            try:
                img[blackP] = pg.image.load("textures/" + blackP + ".png")
                img[whiteP] = pg.image.load("textures/" + whiteP + ".png")
            except FileNotFoundError:
                img[blackP] = pg.image.load("chess/textures/" + blackP + ".png")
                img[whiteP] = pg.image.load("chess/textures/" + whiteP + ".png")
        self.images = img

    def drawBoard(self, screen, *args):
        try:
            # this only executes if optional arguments are provided by findmoves
            squares = args[0]
            p = args[1]
            for i in range(L):
                for j in range(L):
                    if (i, j) == p:
                        # current position of piece, default yellow
                        pg.draw.rect(screen, self.colours["currentsquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                    elif ((i, j) in squares) and ((i + j) % 2 == 1):
                        # possible position(s) of piece on dark squares, default seagreen
                        pg.draw.rect(screen, self.colours["darkpossiblesquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                    elif ((i, j) in squares) and ((i + j) % 2 == 0):
                        # possible position(s) of piece on light sqaures, default lightgreen
                        pg.draw.rect(screen, self.colours["lightpossiblesquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                    elif ((i + j) % 2) == 0:
                        # light squares, default white
                        pg.draw.rect(screen, self.colours["lightsquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                    else:
                        # dark squares, default gray
                        pg.draw.rect(screen, self.colours["darksquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
        except IndexError:
            for i in range(L):
                for j in range(L):
                    if ((i + j) % 2) == 0:
                        pg.draw.rect(screen, self.colours["lightsquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
                    else:
                        pg.draw.rect(screen, self.colours["darksquare"], pg.Rect(j*SQ, i*SQ, SQ, SQ))
        return

    def loadColours(self):
        # Default hardcoded colour values
        clrs = {"lightsquare": "white", "darksquare": "gray", "currentsquare": "yellow",
                "darkpossiblesquare": "seagreen", "lightpossiblesquare": "lightgreen"}
        try:
            try:  # depending on where the config file is located, load file into memory
                with open("config.txt", 'r') as data:
                    text = data.read()
            except FileNotFoundError:
                with open("chess/config.txt", 'r') as data:
                    text = data.read()
            for key in clrs:
                try:
                    par = search(key + " = {:w}", text)[0]  # search the file for
                except TypeError:  # if search could not find a valid field
                    print("please create a field for " + key)
                    clrs[key] = pg.Color(clrs[key])
                    continue
                try:
                    clrs[key] = pg.Color(par)
                except ValueError:
                    print('"' + par + '" is not a valid colour, please select a colour that pygame will recognise')
                    clrs[key] = pg.Color(clrs[key])
            self.colours = clrs
        except FileNotFoundError:
            print("no config.txt file available")
            self.colours = dict([(l, pg.Color(clrs[l])) for l in clrs])
    
    def allPieces(self):
        pcs = []
        for r in self.state:
            for c in r:
                if c != None:
                    pcs.append(c)
        return pcs



class Move:
    def __init__(self, piece, move, special=None):
        # check if the move is valid, i.e moves to a square in range, to a place other 
        # than its start position, and wont cause the moving player to endanger their king
        if (not checkInBounds(move)) or (move == piece.curpos) or (piece.game.isOccupied(move) == piece.colour):
            self.valid = False
            return
        else:
            self.valid = True
        self.colour = piece.colour  # piece's colour
        self.first = piece.neverMoved  # true if it is the piece's first move, to restore the piece's neverMoved value if game.undo()
        self.start = piece.curpos  # where the piece moved from
        self.end = move  # where the piece moved to
        self.content = piece.game[move]  # what was contained in the square that the piece moved into
        self.special = special  # None if not special, up if pawn upgrade, ep if pawn en passent, dj if pawn double jump, ca if castle
        if special == 'ep':
            d = {'w': 1, 'b': -1}
            self.pawn = piece.game[self.end[0] + d[self.colour]][self.end[1]]  # save the pointer to the captured pawn
        elif special == 'ca':
            c = {2: 0, 6: 7}
            self.rook = piece.game[self.end[0]][c[self.end[1]]]  # save the pointer to the moved rook


def main():
    board = Game()  # the actual chess board, just a matrix/2d list
    board.start()  # initialises colours, images, and the board
    # TMP
    board.state = [[None for i in range(8)] for j in range(8)]
    board[(1, 2)] = Piece('w', 'K', 1, 2, board)
    board[(4, 4)] = Piece('b', 'K', 4, 4, board)
    board[(7, 7)] = Piece('w', 'p', 7, 7, board)

    # TMP
    pg.init()
    screen = pg.display.set_mode((PX, PX))
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
                    continue
                c = event.pos[0] // SQ
                r = event.pos[1] // SQ
                if selected == None:  # if no square is selected
                    if board.isOccupied((r, c)) == board.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        board.drawScreen(screen, board[r][c].findMoves(False), (r, c))
                else:
                    # determines if a move is legal for the selected piece, returns false if not and the move if yes
                    move = board.isMove(selected, (r, c))
                    if move:  # THIS IS WHERE THE PLAYER MOVES THEIR PIECES
                        # only move if the piece you already have selected can move to the new square you have selected
                        board[selected].move(move)
                        selected = None
                        board.changeTurn()
                        board.drawScreen(screen)
                        ch = {'b': "BLACK", 'w': "WHITE"}
                        # TODO: STALEMATE WHEN ONLY TWO KINGS ARE ON THE BOARD
                        if len(board.allPieces()) <= 2:  # if there are only two or fewer pieces on the board
                            # meaning that, legally, there can only be two kings and therefore no way for either side to win
                            # STALEMATE
                            print("STALEMATE")
                        elif len(board.getAllMoves(board.turn)) == 0:  # if the new active player has no moves
                            if board.checkForCheck(board.turn):  # if the newly active player is in check, meaning that they got checkmated
                                # CHECKMATE
                                print(ch[board.turn] + " HAS BEEN CHECKMATED")
                            else:
                                # STALEMATE
                                print("STALEMATE")
                        elif board.checkForCheck(board.turn):
                            # CHECK
                            print(ch[board.turn] + " HAS BEEN CHECKED")
                            board.lastMove().check = True
                    elif (r, c) == selected:  # if you click the already selected square
                        selected = None
                        board.drawScreen(screen)
                    elif board.isOccupied((r, c)) == board.turn:  # if piece on square belongs to the active player
                        selected = (r, c)
                        board.drawScreen(screen, board[r][c].findMoves(False), (r, c))
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
                    except KeyError:
                        print("cannot undo further")
                elif event.key == pg.K_TAB:  # if tab is pressed, redo last undid move
                    if board.redo() == False:
                        print("cannot redo further")
                        continue
                    board.changeTurn()
                    board.drawScreen(screen)
                    selected = None
                # TODO: PGN FILES USING SAN


if __name__ == "__main__":
    main()