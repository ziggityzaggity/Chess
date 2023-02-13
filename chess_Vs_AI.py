import pygame as pg
from time import sleep
from objects import *  # Piece, Game, Move
from ai import *

L = 8  # length of the chess board
PX = 480  # number of pixels long that the height/width of the board is
SQ = PX // L  # number of pixels high/wide each square is



def main():
    board = Game()  # the actual chess board, just a matrix/2d list
    board.start()  # initialises colours, images, and the board
    pg.init()
    screen = pg.display.set_mode((PX, PX))
    board.drawScreen(screen)
    running = True
    selected = None
    robot = Random(board, ['w', 'b'][int(bool(randbytes(1)))])
    while running:
        sleep(0.1)
        if board.turn == robot.colour:# THIS IS WHERE THE ROBOT MOVES THEIR PIECES
            move = robot.getMove(board.getAllMoves(robot.colour))
            board.move(move)
            selected = None
            board.changeTurn()
            board.drawScreen(screen)
            board.announce()
            
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
                        board.announce()
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
                    if board.index > 1:
                        board.undo()
                        board.undo()
                        board.drawScreen(screen)
                        selected = None
                    else:
                        print("cannot undo further")
                elif event.key == pg.K_TAB:  # if tab is pressed, redo last undid move
                    if board.index < len(board.moves) - 1:
                        board.redo()
                        board.redo()
                        board.drawScreen(screen)
                        selected = None
                    else:
                        print("cannot redo further")
                # TODO: PGN FILES USING SAN


if __name__ == "__main__":
    main()