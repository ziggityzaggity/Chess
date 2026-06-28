import pygame as pg
from time import sleep
from objects import *

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
    while running:
        sleep(0.1)
        for event in pg.event.get():
           board.registerEvent(selected, event, screen)
           
           # TODO: PGN FILES USING SAN


if __name__ == "__main__":
    main()