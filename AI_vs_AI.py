import pygame as pg
from time import sleep
from objects import *  # Piece, Game, Move
from ai import *

L = 8  # length of the chess board
PX = 480  # number of pixels long that the height/width of the board is
SQ = PX // L  # number of pixels high/wide each square is
OPP = {'w': 'b', 'b': 'w'}


def main():
    board = Game()  # the actual chess board, just a matrix/2d list
    board.start()  # initialises colours, images, and the board
    pg.init()
    screen = pg.display.set_mode((PX, PX))
    board.drawScreen(screen)
    running = True
    robot1 = Random(board)
    robot2 = Random(board, colour=OPP[robot1.colour])
    i=0
    while running:
        i+=1
        sleep(0.1)
        if board.turn == robot1.colour and i < 15:# THIS IS WHERE THE ROBOT MOVES THEIR PIECES
            move = robot1.getMove(board.getAllMoves(robot1.colour))
            board.move(move)
            selected = None
            board.changeTurn()
            board.drawScreen(screen)
            board.announce()
        elif i < 15:
            move = robot2.getMove(board.getAllMoves(robot2.colour))
            board.move(move)
            selected = None
            board.changeTurn()
            board.drawScreen(screen)
            board.announce()
            
        for event in pg.event.get():
            if event.type == pg.QUIT:
                running = False
            elif event.type == pg.KEYDOWN:
                if event.key == pg.K_BACKSPACE:  # if backspace is pressed, undo last move
                    if board.index > 0:
                        board.undo()
                        board.changeTurn()
                        board.drawScreen(screen)
                    else:
                        print("cannot undo further")
                elif event.key == pg.K_TAB:  # if tab is pressed, redo last undid move
                    if board.index >= len(board.moves):
                        print("cannot redo further")
                        continue
                    board.redo()
                    board.changeTurn()
                    board.drawScreen(screen)
                    


if __name__ == "__main__":
    main()